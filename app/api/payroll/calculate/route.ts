import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'
import { todayISO } from '../../../../utils/dates'
import { PayrollHelpers, PaymentMethod } from '../../../../lib/types'
import { 
  getCurrentWeekRange, 
  getCurrentBiWeeklyRange, 
  getEmployeesWithCurrentPeriodLoads,
  hasCurrentPeriodLoads
} from '../../../../lib/payroll-utils'

// POST /api/payroll/calculate - Calculate payroll for a specific period
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { payrollPeriodId } = body
    
    if (!payrollPeriodId) {
      return NextResponse.json(
        { error: 'Payroll period ID is required' },
        { status: 400 }
      )
    }
    
    // Get payroll period
    const payrollPeriod = await prisma.payrollPeriod.findUnique({
      where: { id: parseInt(payrollPeriodId) }
    })
    
    if (!payrollPeriod) {
      return NextResponse.json(
        { error: 'Payroll period not found' },
        { status: 404 }
      )
    }
    
    // Determine pay frequency from period type
    const payFrequency = payrollPeriod.periodType as 'WEEKLY' | 'BI_WEEKLY'
    
    // Get employees with current period loads (for auto-inclusion)
    const employeesWithCurrentLoads = await getEmployeesWithCurrentPeriodLoads(payFrequency, prisma)
    
    // Get all active employees
    const employees = await prisma.employee.findMany({
      where: { status: 'ACTIVE' }
    })
    
    const calculationResults = []
    let totalGrossPay = 0
    let totalNetPay = 0
    let totalDeductions = 0
    
    for (const employee of employees) {
      console.log(`\n💼 Processing employee: ${employee.name} (ID: ${employee.id}) - Status: ${employee.status}`)
      
      // Skip inactive employees
      if (employee.status !== 'ACTIVE') {
        console.log(`⏩ Skipping inactive employee: ${employee.name}`)
        continue
      }
      
      // Get employee's completed loads in this period
      let loads = await prisma.load.findMany({
        where: {
          driverId: employee.id,
          status: 'DELIVERED',
          deliveryDate: {
            gte: payrollPeriod.startDate,
            lte: payrollPeriod.endDate
          }
        },
        select: {
          id: true,
          loadNumber: true,
          status: true,
          deliveryDate: true,
          grossAmount: true,
          driverRate: true,
          finalMiles: true,
          paymentMethod: true,
          payPerMileRate: true
        }
      })
      
      console.log(`📦 Found ${loads.length} delivered loads in payroll period (${payrollPeriod.startDate} to ${payrollPeriod.endDate})`)
      
      // AUTO-INCLUDE CURRENT PERIOD LOADS:
      // If employee has delivered loads in current week/bi-weekly period,
      // automatically include all their current period loads
      if (employeesWithCurrentLoads.includes(employee.id)) {
        console.log(`🔄 Employee ${employee.name} has current period loads - checking for auto-inclusion`)
        
        let currentPeriod: { startDate: string; endDate: string }
        
        if (payFrequency === 'WEEKLY') {
          currentPeriod = getCurrentWeekRange()
        } else {
          currentPeriod = getCurrentBiWeeklyRange()
        }
        
        console.log(`📅 Current ${payFrequency} period: ${currentPeriod.startDate} to ${currentPeriod.endDate}`)
        
        // Check if current period is different from payroll period
        const isCurrentPeriodDifferent = 
          currentPeriod.startDate !== payrollPeriod.startDate ||
          currentPeriod.endDate !== payrollPeriod.endDate
        
        if (isCurrentPeriodDifferent) {
          console.log(`🔀 Current period differs from payroll period - fetching current period loads`)
          
          // Get current period loads for this employee
          const currentPeriodLoads = await prisma.load.findMany({
            where: {
              driverId: employee.id,
              status: 'DELIVERED',
              deliveryDate: {
                gte: currentPeriod.startDate,
                lte: currentPeriod.endDate
              }
            },
            select: {
              id: true,
              loadNumber: true,
              status: true,
              deliveryDate: true,
              grossAmount: true,
              driverRate: true,
              finalMiles: true,
              paymentMethod: true,
              payPerMileRate: true
            }
          })
          
          console.log(`📦 Found ${currentPeriodLoads.length} delivered loads in current period`)
          
          // Add current period loads to existing loads (avoid duplicates)
          const existingLoadIds = new Set(loads.map(load => load.id))
          const newCurrentLoads = currentPeriodLoads.filter(load => !existingLoadIds.has(load.id))
          loads = [...loads, ...newCurrentLoads]
          
          console.log(`🚛 Auto-included ${newCurrentLoads.length} current period loads for ${employee.name}`)
          if (newCurrentLoads.length > 0) {
            console.log(`   New loads: ${newCurrentLoads.map(l => l.loadNumber).join(', ')}`)
          }
        } else {
          console.log(`✅ Current period matches payroll period - no additional loads to include`)
        }
      } else {
        console.log(`⏸️  Employee ${employee.name} has no current period loads`)
      }
      
      console.log(`📊 Total loads for processing: ${loads.length}`)
      
      if (loads.length === 0) {
        console.log(`⏩ Skipping ${employee.name} - no loads to process`)
        continue // Skip employees with no loads
      }
      
      // Log load details for debugging
      console.log(`📋 Load details for ${employee.name}:`)
      loads.forEach(load => {
        console.log(`   • ${load.loadNumber}: $${load.grossAmount} gross, $${load.driverRate || 0} driver rate, ${load.finalMiles || 0} miles, delivered ${load.deliveryDate}`)
      })
      
      // Get employee's current payment configuration
      let paymentConfig = {
        paymentMethod: employee.paymentMethod as PaymentMethod,
        driverPercent: employee.driverPercent,
        payPerMileRate: employee.payPerMileRate
      }
      
      // Check for historical payment config at start of pay period
      const historicalConfig = await prisma.paymentMethodHistory.findFirst({
        where: {
          employeeId: employee.id,
          effectiveDate: { lte: payrollPeriod.startDate },
          OR: [
            { endDate: { gte: payrollPeriod.startDate } },
            { endDate: null }
          ]
        },
        orderBy: { effectiveDate: 'desc' }
      })
      
      if (historicalConfig) {
        paymentConfig = {
          paymentMethod: historicalConfig.paymentMethod as PaymentMethod,
          driverPercent: historicalConfig.driverPercent,
          payPerMileRate: historicalConfig.payPerMileRate
        }
      }
      
      console.log(`💰 Payment configuration for ${employee.name}:`)
      console.log(`   Method: ${paymentConfig.paymentMethod}`)
      console.log(`   Driver %: ${paymentConfig.driverPercent}%`)
      console.log(`   Per Mile Rate: $${paymentConfig.payPerMileRate}/mile`)
      
      // Calculate earnings based on payment method
      let grossPay = 0
      let totalMiles = 0
      let grossRevenue = 0
      let paymentDetails = []
      
      console.log(`🧮 Calculating pay for ${loads.length} loads:`)
      
      for (const load of loads) {
        const loadGross = load.grossAmount || 0
        const loadMiles = load.finalMiles || 0
        let loadDriverPay = 0
        
        grossRevenue += loadGross
        totalMiles += loadMiles
        
        switch (paymentConfig.paymentMethod) {
          case 'PERCENTAGE':
            loadDriverPay = loadGross * (paymentConfig.driverPercent / 100)
            console.log(`   • ${load.loadNumber}: $${loadGross} × ${paymentConfig.driverPercent}% = $${loadDriverPay.toFixed(2)}`)
            break
          case 'PAY_PER_MILE':
            loadDriverPay = loadMiles * paymentConfig.payPerMileRate
            console.log(`   • ${load.loadNumber}: ${loadMiles} miles × $${paymentConfig.payPerMileRate} = $${loadDriverPay.toFixed(2)}`)
            break
          case 'FLAT_RATE':
            loadDriverPay = load.driverRate || 0
            console.log(`   • ${load.loadNumber}: Flat rate = $${loadDriverPay.toFixed(2)}${!load.driverRate ? ' (WARNING: No driver rate set!)' : ''}`)
            if (!load.driverRate) {
              console.warn(`⚠️  Load ${load.loadNumber} has no driver rate set for FLAT_RATE payment!`)
            }
            break
          default:
            console.warn(`⚠️  Unknown payment method: ${paymentConfig.paymentMethod}`)
            break
        }
        
        grossPay += loadDriverPay
        paymentDetails.push({
          loadNumber: load.loadNumber,
          grossAmount: loadGross,
          miles: loadMiles,
          driverPay: loadDriverPay,
          method: paymentConfig.paymentMethod
        })
      }
      
      console.log(`💵 Total calculations for ${employee.name}:`)
      console.log(`   Total Miles: ${totalMiles}`)
      console.log(`   Gross Revenue: $${grossRevenue.toFixed(2)}`)
      console.log(`   Gross Driver Pay: $${grossPay.toFixed(2)}`)
      
      // Update load records with calculated payment info if needed
      for (let i = 0; i < loads.length; i++) {
        const load = loads[i]
        const detail = paymentDetails[i]
        
        // Only update if the load doesn't have payment info or if it's different
        const needsUpdate = !load.driverRate || 
                           Math.abs(load.driverRate - detail.driverPay) > 0.01 ||
                           load.paymentMethod !== paymentConfig.paymentMethod
        
        if (needsUpdate) {
          console.log(`🔄 Updating payment info for load ${load.loadNumber}`)
          await prisma.load.update({
            where: { id: load.id },
            data: {
              driverRate: detail.driverPay,
              paymentMethod: paymentConfig.paymentMethod,
              payPerMileRate: paymentConfig.payPerMileRate,
              paymentCalculatedAt: todayISO(),
              paymentCalculatedBy: 'payroll-calculation-api'
            }
          })
        }
      }
      
      // Get any active advances for repayment
      const advances = await prisma.payrollAdvance.findMany({
        where: {
          employeeId: employee.id,
          status: 'ACTIVE',
          remainingBalance: { gt: 0 }
        }
      })
      
      // Calculate deductions
      const deductions = []
      
      // Standard tax deductions
      const federalTax = PayrollHelpers.calculateFederalTax(grossPay)
      const stateTax = PayrollHelpers.calculateStateTax(grossPay, 'MI') // Default Michigan
      const ficaTax = PayrollHelpers.calculateFICA(grossPay)
      
      deductions.push(
        { type: 'FEDERAL_TAX', name: 'Federal Income Tax', amount: federalTax },
        { type: 'STATE_TAX', name: 'State Income Tax', amount: stateTax },
        { type: 'FICA', name: 'Social Security & Medicare', amount: ficaTax }
      )
      
      // Handle advance repayments
      let totalAdvanceRepayment = 0
      const advanceRepayments = []
      
      for (const advance of advances) {
        let repaymentAmount = 0
        
        if (advance.repaymentType === 'WEEKLY') {
          repaymentAmount = Math.min(advance.weeklyRepayment, advance.remainingBalance)
        } else {
          // Calculate based on percentage of pay or other logic
          repaymentAmount = Math.min(grossPay * 0.1, advance.remainingBalance) // Max 10% of gross pay
        }
        
        if (repaymentAmount > 0) {
          totalAdvanceRepayment += repaymentAmount
          advanceRepayments.push({
            id: advance.id,
            repaymentAmount
          })
          deductions.push({
            type: 'ADVANCE_REPAY',
            name: `Advance Repayment (${advance.advanceDate})`,
            amount: repaymentAmount
          })
        }
      }
      
      const totalDeductionAmount = deductions.reduce((sum, d) => sum + d.amount, 0)
      const netPay = grossPay - totalDeductionAmount
      
      // Create or update individual payroll record
      const existingPayroll = await prisma.individualPayroll.findFirst({
        where: {
          employeeId: employee.id,
          weekStartDate: payrollPeriod.weekStartDate,
          weekEndDate: payrollPeriod.weekEndDate
        }
      })
      
      let individualPayroll
      if (existingPayroll) {
        // Update existing individual payroll
        individualPayroll = await prisma.individualPayroll.update({
          where: { id: existingPayroll.id },
          data: {
            totalMiles,
            totalLoads: loads.length,
            grossRevenue,
            driverPercentage: paymentConfig.driverPercent,
            payPerMileRate: paymentConfig.payPerMileRate,
            grossPay,
            totalDeductions: totalDeductionAmount,
            netPay,
            modifiedDate: todayISO()
          }
        })
        
        // Delete existing deductions and recreate
        await prisma.payrollDeduction.deleteMany({
          where: { paystubId: existingPaystub.id }
        })
      } else {
        // Create new paystub
        paystub = await prisma.paystub.create({
          data: {
            employeeId: employee.id,
            payrollPeriodId: parseInt(payrollPeriodId),
            employeeName: employee.name,
            employeeType: employee.driverType,
            paymentMethod: paymentConfig.paymentMethod,
            totalMiles,
            totalLoads: loads.length,
            grossRevenue,
            driverPercentage: paymentConfig.driverPercent,
            payPerMileRate: paymentConfig.payPerMileRate,
            grossPay,
            totalDeductions: totalDeductionAmount,
            netPay,
            status: 'DRAFT',
            generatedDate: todayISO(),
            createdDate: todayISO(),
            createdBy: 'payroll-calculation'
          }
        })
      }
      
      // Create deductions
      for (const deduction of deductions) {
        await prisma.payrollDeduction.create({
          data: {
            paystubId: paystub.id,
            deductionType: deduction.type,
            deductionName: deduction.name,
            calculationType: deduction.type === 'ADVANCE_REPAY' ? 'FIXED_AMOUNT' : 'PERCENTAGE',
            rate: deduction.type === 'ADVANCE_REPAY' ? deduction.amount : 0,
            baseAmount: grossPay,
            deductedAmount: deduction.amount,
            createdDate: todayISO()
          }
        })
      }
      
      // Update advance balances
      for (const repayment of advanceRepayments) {
        await prisma.payrollAdvance.update({
          where: { id: repayment.id },
          data: {
            repaidAmount: {
              increment: repayment.repaymentAmount
            },
            remainingBalance: {
              decrement: repayment.repaymentAmount
            },
            paystubId: paystub.id,
            modifiedDate: todayISO()
          }
        })
        
        // Mark as paid if fully repaid
        const updatedAdvance = await prisma.payrollAdvance.findUnique({
          where: { id: repayment.id }
        })
        
        if (updatedAdvance && updatedAdvance.remainingBalance <= 0.01) {
          await prisma.payrollAdvance.update({
            where: { id: repayment.id },
            data: { status: 'PAID' }
          })
        }
      }
      
      totalGrossPay += grossPay
      totalNetPay += netPay
      totalDeductions += totalDeductionAmount
      
      calculationResults.push({
        employeeId: employee.id,
        employeeName: employee.name,
        paymentMethod: paymentConfig.paymentMethod,
        totalMiles,
        totalLoads: loads.length,
        grossRevenue,
        grossPay,
        deductions,
        totalDeductions: totalDeductionAmount,
        netPay,
        advances: advanceRepayments
      })
    }
    
    // Update payroll period totals
    await prisma.payrollPeriod.update({
      where: { id: parseInt(payrollPeriodId) },
      data: {
        totalGrossPay,
        totalNetPay,
        totalDeductions,
        employeeCount: calculationResults.length,
        status: calculationResults.length > 0 ? 'PROCESSING' : 'DRAFT',
        processedDate: calculationResults.length > 0 ? todayISO() : null,
        modifiedDate: todayISO()
      }
    })
    
    return NextResponse.json({
      payrollPeriodId: parseInt(payrollPeriodId),
      employeeCount: calculationResults.length,
      totalGrossPay,
      totalDeductions,
      totalNetPay,
      calculations: calculationResults
    })
  } catch (error) {
    console.error('Error calculating payroll:', error)
    return NextResponse.json(
      { error: 'Failed to calculate payroll' },
      { status: 500 }
    )
  }
}
