import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../../../lib/prisma'
import { todayISO } from '../../../../../../utils/dates'

// POST /api/payroll/individual/[id]/calculate - Calculate final payroll with all adjustments
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id)
    const body = await req.json()
    const { calculatedBy = 'web-api' } = body
    
    if (isNaN(id)) {
      return NextResponse.json(
        { error: 'Invalid payroll ID' },
        { status: 400 }
      )
    }
    
    // Get payroll record with all related data
    const payroll = await prisma.individualPayroll.findUnique({
      where: { id },
      include: {
        loads: {
          where: { isIncluded: true }
        },
        adjustments: {
          where: { status: { in: ['ACTIVE', 'APPROVED'] } }
        }
      }
    })
    
    if (!payroll) {
      return NextResponse.json(
        { error: 'Payroll not found' },
        { status: 404 }
      )
    }
    
    if (payroll.isLocked) {
      return NextResponse.json(
        { error: 'Cannot recalculate locked payroll' },
        { status: 400 }
      )
    }
    
    console.log(`🧮 Calculating payroll for ${payroll.employeeName} (${payroll.weekStartDate} to ${payroll.weekEndDate})`)
    
    // Start with base pay from loads
    let grossPay = payroll.basePay
    let totalDeductions = 0
    let totalReimbursements = 0
    let bonusAmount = 0
    let fuelDeductions = 0
    let advanceRepayments = 0
    let otherDeductions = 0
    let overtime = 0
    let otherEarnings = 0
    
    console.log(`💰 Starting calculation:`)
    console.log(`   Base pay: $${payroll.basePay.toFixed(2)}`)
    console.log(`   Processing ${payroll.adjustments?.length || 0} adjustments`)
    
    // Apply adjustments
    for (const adjustment of payroll.adjustments || []) {
      console.log(`   • ${adjustment.category}: ${adjustment.adjustmentName} = $${adjustment.amount}`)
      
      switch (adjustment.category) {
        case 'DEDUCTION':
          totalDeductions += adjustment.amount
          
          // Categorize deductions
          switch (adjustment.adjustmentType) {
            case 'FUEL':
              fuelDeductions += adjustment.amount
              break
            case 'ADVANCE_REPAY':
              advanceRepayments += adjustment.amount
              break
            default:
              otherDeductions += adjustment.amount
              break
          }
          break
          
        case 'REIMBURSEMENT':
          totalReimbursements += adjustment.amount
          grossPay += adjustment.amount
          break
          
        case 'BONUS':
          bonusAmount += adjustment.amount
          grossPay += adjustment.amount
          break
          
        case 'CORRECTION':
          if (adjustment.adjustmentType === 'OVERTIME') {
            overtime += adjustment.amount
            grossPay += adjustment.amount
          } else {
            // General correction - could be positive or negative
            if (adjustment.description && adjustment.description.toLowerCase().includes('deduct')) {
              totalDeductions += adjustment.amount
              otherDeductions += adjustment.amount
            } else {
              otherEarnings += adjustment.amount
              grossPay += adjustment.amount
            }
          }
          break
      }
    }
    
    // Calculate final net pay
    const netPay = grossPay - totalDeductions
    
    console.log(`💵 Final calculations:`)
    console.log(`   Gross Pay: $${grossPay.toFixed(2)}`)
    console.log(`   Total Deductions: $${totalDeductions.toFixed(2)}`)
    console.log(`     - Fuel: $${fuelDeductions.toFixed(2)}`)
    console.log(`     - Advances: $${advanceRepayments.toFixed(2)}`)
    console.log(`     - Other: $${otherDeductions.toFixed(2)}`)
    console.log(`   Bonuses: $${bonusAmount.toFixed(2)}`)
    console.log(`   Reimbursements: $${totalReimbursements.toFixed(2)}`)
    console.log(`   Net Pay: $${netPay.toFixed(2)}`)
    
    // Update payroll record with calculated values
    const updatedPayroll = await prisma.individualPayroll.update({
      where: { id },
      data: {
        grossPay,
        netPay,
        bonusAmount,
        reimbursements: totalReimbursements,
        overtime,
        otherEarnings,
        totalDeductions,
        fuelDeductions,
        advanceRepayments,
        otherDeductions,
        status: 'CALCULATED',
        calculatedDate: todayISO(),
        calculatedBy,
        modifiedDate: todayISO()
      },
      include: {
        loads: true,
        adjustments: true,
        paystub: true
      }
    })
    
    console.log(`✅ Payroll calculation completed for ${payroll.employeeName}`)
    
    return NextResponse.json({
      payroll: updatedPayroll,
      calculation: {
        basePay: payroll.basePay,
        adjustments: payroll.adjustments?.length || 0,
        grossPay,
        totalDeductions,
        netPay,
        breakdown: {
          bonusAmount,
          reimbursements: totalReimbursements,
          overtime,
          otherEarnings,
          fuelDeductions,
          advanceRepayments,
          otherDeductions
        }
      }
    })
    
  } catch (error) {
    console.error('Error calculating payroll:', error)
    return NextResponse.json(
      { error: 'Failed to calculate payroll' },
      { status: 500 }
    )
  }
}
