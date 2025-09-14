import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'
import { PayrollHelpers } from '../../../../lib/types'

// Enhanced Payroll Calculator - Direct port from Java PayrollCalculator.java
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { 
      employeeId, 
      weekStartDate, 
      weekEndDate, 
      includeLoads = true,
      includeFuelDeductions = true,
      includeRecurringFees = true,
      includeAdvances = true,
      includeAdjustments = true,
      calculatedBy 
    } = body

    // Validate required fields
    if (!employeeId || !weekStartDate || !weekEndDate) {
      return NextResponse.json(
        { error: 'Employee ID, week start date, and week end date are required' },
        { status: 400 }
      )
    }

    // Get employee details
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        paymentHistory: {
          where: {
            effectiveDate: { lte: weekEndDate }
          },
          orderBy: { effectiveDate: 'desc' },
          take: 1
        }
      }
    })

    if (!employee) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
    }

    // Get effective payment configuration (current or historical)
    const effectiveConfig = employee.paymentHistory[0] || {
      paymentMethod: employee.paymentMethod,
      driverPercent: employee.driverPercent,
      companyPercent: employee.companyPercent,
      serviceFeePercent: employee.serviceFeePercent,
      payPerMileRate: employee.payPerMileRate
    }

    // Initialize calculation result following Java PayrollCalculator structure
    const result = {
      employeeId,
      employeeName: employee.name,
      weekStartDate,
      weekEndDate,
      paymentMethod: effectiveConfig.paymentMethod,
      
      // Base earnings
      basePay: 0,
      bonusAmount: 0,
      reimbursements: 0,
      overtime: 0,
      otherEarnings: 0,
      grossPay: 0,
      
      // Deductions
      fuelDeductions: 0,
      advanceRepayments: 0,
      recurringFees: 0,
      otherDeductions: 0,
      totalDeductions: 0,
      
      // Net calculations
      netPay: 0,
      
      // Load information
      totalLoads: 0,
      totalMiles: 0,
      grossRevenue: 0,
      
      // Detailed breakdowns
      loads: [] as any[],
      adjustments: [] as any[],
      advances: [] as any[],
      recurringItems: [] as any[],
      fuelTransactions: [] as any[],
      
      // Calculation metadata
      calculatedDate: new Date().toISOString(),
      calculatedBy: calculatedBy || 'enhanced-calculator',
      
      // Service fee calculations (from Java logic)
      serviceFee: 0,
      driverShare: 0,
      companyShare: 0
    }

    // Step 1: Calculate base pay from loads (if included)
    if (includeLoads) {
      const loads = await prisma.load.findMany({
        where: {
          driverId: employeeId,
          status: 'DELIVERED',
          deliveryDate: {
            gte: weekStartDate,
            lte: weekEndDate
          }
        },
        orderBy: { deliveryDate: 'asc' }
      })

      result.loads = loads
      result.totalLoads = loads.length
      result.grossRevenue = loads.reduce((sum, load) => sum + load.grossAmount, 0)
      result.totalMiles = loads.reduce((sum, load) => sum + (load.finalMiles || 0), 0)

      // Calculate base pay using Java PayrollCalculator logic
      switch (effectiveConfig.paymentMethod) {
        case 'PERCENTAGE':
          result.basePay = calculatePercentagePay(loads, effectiveConfig, result)
          break
        case 'PAY_PER_MILE':
          result.basePay = calculateMileagePay(loads, effectiveConfig, result)
          break
        case 'FLAT_RATE':
          result.basePay = calculateFlatRatePay(loads, effectiveConfig, result)
          break
        default:
          result.basePay = calculatePercentagePay(loads, effectiveConfig, result)
      }
    }

    // Step 2: Add bonuses and adjustments (if included)
    if (includeAdjustments) {
      const adjustments = await prisma.payrollAdjustment.findMany({
        where: {
          employeeId,
          effectiveDate: {
            gte: weekStartDate,
            lte: weekEndDate
          }
        }
      })

      result.adjustments = adjustments
      result.bonusAmount = adjustments
        .filter(adj => adj.category === 'BONUS')
        .reduce((sum, adj) => sum + adj.amount, 0)
      
      result.reimbursements = adjustments
        .filter(adj => adj.category === 'REIMBURSEMENT')
        .reduce((sum, adj) => sum + adj.amount, 0)
    }

    // Step 3: Calculate fuel deductions (if included)
    if (includeFuelDeductions) {
      const fuelTransactions = await prisma.fuel.findMany({
        where: {
          employeeId,
          date: {
            gte: weekStartDate,
            lte: weekEndDate
          }
        }
      })

      result.fuelTransactions = fuelTransactions
      result.fuelDeductions = fuelTransactions.reduce((sum, fuel) => sum + fuel.amount, 0)
    }

    // Step 4: Calculate advance repayments (if included)
    if (includeAdvances) {
      const activeAdvances = await prisma.payrollAdvance.findMany({
        where: {
          employeeId,
          status: 'ACTIVE',
          firstRepaymentDate: { lte: weekEndDate }
        }
      })

      result.advances = activeAdvances
      result.advanceRepayments = calculateAdvanceRepayments(activeAdvances, weekStartDate, weekEndDate)
    }

    // Step 5: Calculate recurring fees (if included) - ELD, IFTA, etc.
    if (includeRecurringFees) {
      const recurringItems = await prisma.payrollRecurring.findMany({
        where: {
          employeeId,
          isActive: true,
          weekStart: {
            lte: weekStartDate
          },
          OR: [
            { endDate: null },
            { endDate: { gte: weekEndDate } }
          ]
        }
      })

      result.recurringItems = recurringItems
      result.recurringFees = recurringItems.reduce((sum, item) => sum + item.amount, 0)
    }

    // Step 6: Calculate other deductions from adjustments
    if (includeAdjustments && result.adjustments.length > 0) {
      result.otherDeductions = result.adjustments
        .filter(adj => adj.category === 'DEDUCTION')
        .reduce((sum, adj) => sum + adj.amount, 0)
    }

    // Step 7: Final calculations (following Java PayrollCalculator logic)
    result.grossPay = result.basePay + result.bonusAmount + result.reimbursements + result.overtime + result.otherEarnings
    result.totalDeductions = result.fuelDeductions + result.advanceRepayments + result.recurringFees + result.otherDeductions
    result.netPay = Math.max(0, result.grossPay - result.totalDeductions)

    // Round all monetary values to 2 decimal places
    const moneyFields = [
      'basePay', 'bonusAmount', 'reimbursements', 'overtime', 'otherEarnings', 'grossPay',
      'fuelDeductions', 'advanceRepayments', 'recurringFees', 'otherDeductions', 'totalDeductions',
      'netPay', 'serviceFee', 'driverShare', 'companyShare'
    ]
    
    moneyFields.forEach(field => {
      result[field as keyof typeof result] = Math.round((result[field as keyof typeof result] as number) * 100) / 100
    })

    return NextResponse.json({
      success: true,
      calculation: result,
      summary: {
        employeeName: employee.name,
        paymentMethod: effectiveConfig.paymentMethod,
        totalLoads: result.totalLoads,
        totalMiles: result.totalMiles,
        grossPay: PayrollHelpers.formatCurrency(result.grossPay),
        totalDeductions: PayrollHelpers.formatCurrency(result.totalDeductions),
        netPay: PayrollHelpers.formatCurrency(result.netPay)
      }
    })

  } catch (error) {
    console.error('Enhanced payroll calculation error:', error)
    return NextResponse.json(
      { error: 'Failed to calculate payroll' },
      { status: 500 }
    )
  }
}

// Helper function: Calculate percentage-based pay (from Java PayrollCalculator)
function calculatePercentagePay(loads: any[], config: any, result: any): number {
  let totalDriverPay = 0
  let totalServiceFee = 0
  let totalCompanyShare = 0

  for (const load of loads) {
    // Calculate service fee first
    const serviceFee = load.grossAmount * (config.serviceFeePercent / 100)
    const grossAfterServiceFee = load.grossAmount - serviceFee
    
    // Calculate driver and company shares
    const driverShare = grossAfterServiceFee * (config.driverPercent / 100)
    const companyShare = grossAfterServiceFee * (config.companyPercent / 100)
    
    totalDriverPay += driverShare
    totalServiceFee += serviceFee
    totalCompanyShare += companyShare
  }

  // Store detailed breakdown
  result.serviceFee = totalServiceFee
  result.driverShare = totalDriverPay
  result.companyShare = totalCompanyShare

  return totalDriverPay
}

// Helper function: Calculate mileage-based pay
function calculateMileagePay(loads: any[], config: any, result: any): number {
  let totalDriverPay = 0
  let totalServiceFee = 0
  
  for (const load of loads) {
    const miles = load.finalMiles || load.calculatedMiles || 0
    const driverPay = miles * (config.payPerMileRate || 0)
    const serviceFee = load.grossAmount * (config.serviceFeePercent / 100)
    
    totalDriverPay += driverPay
    totalServiceFee += serviceFee
  }

  result.serviceFee = totalServiceFee
  result.driverShare = totalDriverPay

  return totalDriverPay
}

// Helper function: Calculate flat rate pay
function calculateFlatRatePay(loads: any[], config: any, result: any): number {
  let totalDriverPay = 0
  let totalServiceFee = 0
  
  for (const load of loads) {
    // For flat rate, use the stored driverRate from the load
    const driverPay = load.driverRate || 0
    const serviceFee = load.grossAmount * (config.serviceFeePercent / 100)
    
    totalDriverPay += driverPay
    totalServiceFee += serviceFee
  }

  result.serviceFee = totalServiceFee
  result.driverShare = totalDriverPay

  return totalDriverPay
}

// Helper function: Calculate advance repayments (from Java PayrollAdvances logic)
function calculateAdvanceRepayments(advances: any[], weekStart: string, weekEnd: string): number {
  let totalRepayment = 0

  for (const advance of advances) {
    // Check if this week falls within the repayment period
    const weekStartDate = new Date(weekStart)
    const firstRepayment = new Date(advance.firstRepaymentDate)
    const lastRepayment = new Date(advance.lastRepaymentDate)

    if (weekStartDate >= firstRepayment && weekStartDate <= lastRepayment) {
      totalRepayment += advance.weeklyRepayment || 0
    }
  }

  return totalRepayment
}
