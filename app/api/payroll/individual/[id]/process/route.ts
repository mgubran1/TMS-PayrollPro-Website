import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../../../lib/prisma'
import { todayISO } from '../../../../../../utils/dates'

// POST /api/payroll/individual/[id]/process - Process payroll and generate paystub
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id)
    const body = await req.json()
    const { processedBy = 'web-api', generatePaystub = true, lockPayroll = true } = body
    
    if (isNaN(id)) {
      return NextResponse.json(
        { error: 'Invalid payroll ID' },
        { status: 400 }
      )
    }
    
    // Get payroll record
    const payroll = await prisma.individualPayroll.findUnique({
      where: { id },
      include: {
        loads: true,
        adjustments: {
          where: { status: { in: ['ACTIVE', 'APPROVED'] } }
        },
        paystub: true
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
        { error: 'Payroll is already locked' },
        { status: 400 }
      )
    }
    
    if (payroll.status !== 'CALCULATED' && payroll.status !== 'REVIEWED') {
      return NextResponse.json(
        { error: 'Payroll must be calculated before processing' },
        { status: 400 }
      )
    }
    
    console.log(`🔄 Processing payroll for ${payroll.employeeName} (${payroll.weekStartDate} to ${payroll.weekEndDate})`)
    
    let paystub = null
    
    if (generatePaystub) {
      // Check if paystub already exists
      if (payroll.paystub) {
        console.log(`📄 Paystub already exists, updating...`)
        
        // Update existing paystub
        paystub = await prisma.paystub.update({
          where: { id: payroll.paystub.id },
          data: {
            employeeName: payroll.employeeName,
            weekStartDate: payroll.weekStartDate,
            weekEndDate: payroll.weekEndDate,
            payDate: payroll.payDate,
            paymentMethod: payroll.paymentMethod || 'PERCENTAGE',
            basePayRate: payroll.basePayRate,
            totalMiles: payroll.totalMiles,
            totalLoads: payroll.totalLoads,
            grossRevenue: payroll.grossRevenue,
            basePay: payroll.basePay,
            bonusAmount: payroll.bonusAmount,
            overtime: payroll.overtime,
            reimbursements: payroll.reimbursements,
            otherEarnings: payroll.otherEarnings,
            totalDeductions: payroll.totalDeductions,
            fuelDeductions: payroll.fuelDeductions,
            advanceRepayments: payroll.advanceRepayments,
            otherDeductions: payroll.otherDeductions,
            grossPay: payroll.grossPay,
            netPay: payroll.netPay,
            status: 'APPROVED',
            generatedDate: todayISO(),
            modifiedDate: todayISO()
          },
          include: {
            deductions: true,
            reimbursementRecords: true,
            adjustments: true,
            advances: true
          }
        })
      } else {
        console.log(`📄 Creating new paystub...`)
        
        // Create new paystub
        paystub = await prisma.paystub.create({
          data: {
            payrollId: payroll.id,
            employeeId: payroll.employeeId,
            employeeName: payroll.employeeName,
            weekStartDate: payroll.weekStartDate,
            weekEndDate: payroll.weekEndDate,
            payDate: payroll.payDate,
            paymentMethod: payroll.paymentMethod || 'PERCENTAGE',
            basePayRate: payroll.basePayRate,
            totalMiles: payroll.totalMiles,
            totalLoads: payroll.totalLoads,
            grossRevenue: payroll.grossRevenue,
            basePay: payroll.basePay,
            bonusAmount: payroll.bonusAmount,
            overtime: payroll.overtime,
            reimbursements: payroll.reimbursements,
            otherEarnings: payroll.otherEarnings,
            totalDeductions: payroll.totalDeductions,
            fuelDeductions: payroll.fuelDeductions,
            advanceRepayments: payroll.advanceRepayments,
            otherDeductions: payroll.otherDeductions,
            grossPay: payroll.grossPay,
            netPay: payroll.netPay,
            status: 'APPROVED',
            generatedDate: todayISO(),
            createdDate: todayISO(),
            createdBy: processedBy
          },
          include: {
            deductions: true,
            reimbursementRecords: true,
            adjustments: true,
            advances: true
          }
        })
      }
      
      // Link adjustments to the paystub
      for (const adjustment of payroll.adjustments || []) {
        await prisma.payrollAdjustment.update({
          where: { id: adjustment.id },
          data: { paystubId: paystub.id }
        })
      }
    }
    
    // Update payroll status
    const updatedPayroll = await prisma.individualPayroll.update({
      where: { id },
      data: {
        status: 'PROCESSED',
        isLocked: lockPayroll,
        processedDate: todayISO(),
        processedBy,
        modifiedDate: todayISO()
      },
      include: {
        loads: true,
        adjustments: true,
        paystub: {
          include: {
            deductions: true,
            reimbursementRecords: true,
            adjustments: true,
            advances: true
          }
        }
      }
    })
    
    console.log(`✅ Payroll processed successfully for ${payroll.employeeName}`)
    console.log(`   Status: ${updatedPayroll.status}`)
    console.log(`   Locked: ${updatedPayroll.isLocked}`)
    console.log(`   Paystub: ${paystub ? `Generated (ID: ${paystub.id})` : 'Not generated'}`)
    
    return NextResponse.json({
      payroll: updatedPayroll,
      paystub,
      message: 'Payroll processed successfully'
    })
    
  } catch (error) {
    console.error('Error processing payroll:', error)
    return NextResponse.json(
      { error: 'Failed to process payroll' },
      { status: 500 }
    )
  }
}
