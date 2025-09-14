import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../../lib/prisma'

// GET /api/payroll/[id]/paystubs - Get paystubs for a specific payroll period
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const payrollPeriodId = parseInt(params.id)
    
    if (isNaN(payrollPeriodId)) {
      return NextResponse.json(
        { error: 'Invalid payroll period ID' },
        { status: 400 }
      )
    }
    
    // Get paystubs with all related data
    const paystubs = await prisma.paystub.findMany({
      where: { payrollPeriodId },
      include: {
        deductions: {
          orderBy: { deductionType: 'asc' }
        },
        advances: {
          where: { status: 'ACTIVE' }
        }
      },
      orderBy: { employeeName: 'asc' }
    })
    
    // Get payroll period info
    const payrollPeriod = await prisma.payrollPeriod.findUnique({
      where: { id: payrollPeriodId }
    })
    
    if (!payrollPeriod) {
      return NextResponse.json(
        { error: 'Payroll period not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json({
      payrollPeriod,
      paystubs
    })
  } catch (error) {
    console.error('Error fetching paystubs:', error)
    return NextResponse.json(
      { error: 'Failed to fetch paystubs' },
      { status: 500 }
    )
  }
}

// PUT /api/payroll/[id]/paystubs - Update paystub status (bulk operations)
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const payrollPeriodId = parseInt(params.id)
    const body = await req.json()
    const { action, paystubIds, status } = body
    
    if (isNaN(payrollPeriodId)) {
      return NextResponse.json(
        { error: 'Invalid payroll period ID' },
        { status: 400 }
      )
    }
    
    if (!action) {
      return NextResponse.json(
        { error: 'Action is required' },
        { status: 400 }
      )
    }
    
    let updatedPaystubs = []
    
    switch (action) {
      case 'approve':
        // Approve selected paystubs
        if (!paystubIds || paystubIds.length === 0) {
          return NextResponse.json(
            { error: 'Paystub IDs are required for approval' },
            { status: 400 }
          )
        }
        
        updatedPaystubs = await prisma.paystub.updateMany({
          where: {
            id: { in: paystubIds },
            payrollPeriodId,
            status: 'DRAFT'
          },
          data: {
            status: 'APPROVED',
            approvedDate: new Date().toISOString()
          }
        })
        break
        
      case 'approve_all':
        // Approve all paystubs in the period
        updatedPaystubs = await prisma.paystub.updateMany({
          where: {
            payrollPeriodId,
            status: 'DRAFT'
          },
          data: {
            status: 'APPROVED',
            approvedDate: new Date().toISOString()
          }
        })
        break
        
      case 'mark_paid':
        // Mark paystubs as paid
        if (!paystubIds || paystubIds.length === 0) {
          return NextResponse.json(
            { error: 'Paystub IDs are required' },
            { status: 400 }
          )
        }
        
        updatedPaystubs = await prisma.paystub.updateMany({
          where: {
            id: { in: paystubIds },
            payrollPeriodId,
            status: 'APPROVED'
          },
          data: {
            status: 'PAID',
            paidDate: new Date().toISOString()
          }
        })
        break
        
      case 'update_status':
        // Update specific status
        if (!paystubIds || paystubIds.length === 0 || !status) {
          return NextResponse.json(
            { error: 'Paystub IDs and status are required' },
            { status: 400 }
          )
        }
        
        const updateData: any = { status }
        if (status === 'APPROVED') {
          updateData.approvedDate = new Date().toISOString()
        } else if (status === 'PAID') {
          updateData.paidDate = new Date().toISOString()
        }
        
        updatedPaystubs = await prisma.paystub.updateMany({
          where: {
            id: { in: paystubIds },
            payrollPeriodId
          },
          data: updateData
        })
        break
        
      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        )
    }
    
    // Check if all paystubs are approved/paid and update payroll period status
    const allPaystubs = await prisma.paystub.findMany({
      where: { payrollPeriodId },
      select: { status: true }
    })
    
    let newPayrollStatus = 'PROCESSING'
    if (allPaystubs.every(p => p.status === 'APPROVED')) {
      newPayrollStatus = 'APPROVED'
    } else if (allPaystubs.every(p => p.status === 'PAID')) {
      newPayrollStatus = 'PAID'
    }
    
    // Update payroll period status if needed
    const currentPeriod = await prisma.payrollPeriod.findUnique({
      where: { id: payrollPeriodId }
    })
    
    if (currentPeriod && currentPeriod.status !== newPayrollStatus) {
      await prisma.payrollPeriod.update({
        where: { id: payrollPeriodId },
        data: {
          status: newPayrollStatus,
          ...(newPayrollStatus === 'APPROVED' && { approvedDate: new Date().toISOString() }),
          ...(newPayrollStatus === 'PAID' && { paidDate: new Date().toISOString() })
        }
      })
    }
    
    return NextResponse.json({
      message: `Successfully updated ${updatedPaystubs.count} paystubs`,
      updatedCount: updatedPaystubs.count,
      newPayrollStatus
    })
  } catch (error) {
    console.error('Error updating paystubs:', error)
    return NextResponse.json(
      { error: 'Failed to update paystubs' },
      { status: 500 }
    )
  }
}
