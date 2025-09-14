import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'
import { todayISO } from '../../../../utils/dates'

// POST /api/payroll/load-updates - Handle payroll updates when loads are modified/deleted
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, loadData, reason = 'Load modification' } = body
    
    if (!action || !loadData) {
      return NextResponse.json(
        { error: 'Action and load data are required' },
        { status: 400 }
      )
    }
    
    console.log(`🔄 Processing payroll update for load ${loadData.loadNumber}: ${action}`)
    
    let updatedPaystubs = []
    let affectedPeriods = []
    
    switch (action) {
      case 'LOAD_DELETED':
        const deleteResult = await handleLoadDeleted(loadData, reason)
        updatedPaystubs = deleteResult.updatedPaystubs
        affectedPeriods = deleteResult.affectedPeriods
        break
        
      case 'LOAD_MODIFIED':
        const modifyResult = await handleLoadModified(loadData, reason)
        updatedPaystubs = modifyResult.updatedPaystubs
        affectedPeriods = modifyResult.affectedPeriods
        break
        
      case 'LOAD_STATUS_CHANGED':
        const statusResult = await handleLoadStatusChanged(loadData, reason)
        updatedPaystubs = statusResult.updatedPaystubs
        affectedPeriods = statusResult.affectedPeriods
        break
        
      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        )
    }
    
    return NextResponse.json({
      success: true,
      action,
      loadNumber: loadData.loadNumber,
      affectedPaystubs: updatedPaystubs.length,
      affectedPeriods: affectedPeriods.length,
      details: {
        updatedPaystubs,
        affectedPeriods
      }
    })
    
  } catch (error) {
    console.error('❌ Error processing payroll load update:', error)
    return NextResponse.json(
      { error: 'Failed to process payroll update' },
      { status: 500 }
    )
  }
}

// Handle load deletion - remove from existing paystubs and recalculate
async function handleLoadDeleted(loadData: any, reason: string) {
  console.log(`🗑️  Handling deletion of load ${loadData.loadNumber} for driver ${loadData.driverId}`)
  
  const updatedPaystubs = []
  const affectedPeriods = []
  
  if (!loadData.driverId || !loadData.deliveryDate) {
    console.log('❌ Load missing driver ID or delivery date, skipping payroll update')
    return { updatedPaystubs, affectedPeriods }
  }
  
  // Find all individual payrolls that might include this load
  const potentialPayrolls = await prisma.individualPayroll.findMany({
    where: {
      employeeId: loadData.driverId,
      status: { in: ['DRAFT', 'CALCULATED', 'REVIEWED'] }, // Only update non-finalized payrolls
    },
    include: {
      loads: {
        where: {
          loadNumber: loadData.loadNumber
        }
      },
      adjustments: {
        where: {
          loadNumber: loadData.loadNumber
        }
      },
      paystub: {
        include: {
          deductions: true,
          reimbursementRecords: true,
          adjustments: {
            where: {
              loadNumber: loadData.loadNumber
            }
          }
        }
      }
    }
  })
  
  console.log(`📋 Found ${potentialPayrolls.length} potential payrolls to check`)
  
  for (const payroll of potentialPayrolls) {
    // Check if this load is included in this payroll
    const loadInPayroll = payroll.loads.some(load => load.loadNumber === loadData.loadNumber)
    
    if (loadInPayroll) {
      console.log(`🎯 Load ${loadData.loadNumber} was in payroll ${payroll.weekStartDate} to ${payroll.weekEndDate}`)
      
      // Remove the load from the payroll
      await prisma.payrollLoad.deleteMany({
        where: {
          payrollId: payroll.id,
          loadNumber: loadData.loadNumber
        }
      })
      
      // Remove load-specific adjustments
      const loadAdjustments = payroll.adjustments?.filter(adj => adj.loadNumber === loadData.loadNumber) || []
      
      if (loadAdjustments.length > 0) {
        console.log(`🔄 Reversing ${loadAdjustments.length} load-specific adjustments`)
        
        for (const adjustment of loadAdjustments) {
          // Create reversal entry
          await prisma.payrollAdjustment.create({
            data: {
              employeeId: adjustment.employeeId,
              paystubId: adjustment.paystubId,
              category: adjustment.category === 'DEDUCTION' ? 'REIMBURSEMENT' : 'DEDUCTION', // Reverse the effect
              adjustmentType: 'CORRECTION',
              adjustmentName: `LOAD DELETED - Reversal of: ${adjustment.adjustmentName}`,
              description: `Reversal due to load deletion: ${loadData.loadNumber}. Original: ${adjustment.description || 'N/A'}. Reason: ${reason}`,
              amount: adjustment.amount,
              effectiveDate: todayISO(),
              loadNumber: loadData.loadNumber,
              status: 'APPROVED',
              createdDate: todayISO(),
              createdBy: 'load-deletion-handler'
            }
          })
          
          // Mark original as reversed
          await prisma.payrollAdjustment.update({
            where: { id: adjustment.id },
            data: {
              status: 'REVERSED',
              reversedBy: 'load-deletion-handler',
              reversedDate: todayISO(),
              reverseReason: `Load deleted: ${reason}`
            }
          })
        }
      }
      
      // Recalculate paystub totals (simplified - in real implementation, would recalculate from scratch)
      const activeDeductions = await prisma.payrollDeduction.findMany({
        where: { paystubId: paystub.id, status: 'ACTIVE' }
      })
      
      const activeReimbursementRecords = await prisma.payrollReimbursement.findMany({
        where: { paystubId: paystub.id, status: 'ACTIVE' }
      })
      
      const activeAdjustments = await prisma.payrollAdjustment.findMany({
        where: { paystubId: paystub.id, status: 'ACTIVE' }
      })
      
      // Recalculate totals
      let totalDeductions = activeDeductions.reduce((sum, d) => sum + d.deductedAmount, 0)
      let totalReimbursements = activeReimbursementRecords.reduce((sum, r) => sum + r.amount, 0)
      
      // Add adjustment effects
      for (const adj of activeAdjustments) {
        if (adj.category === 'DEDUCTION') {
          totalDeductions += adj.amount
        } else if (adj.category === 'REIMBURSEMENT' || adj.category === 'BONUS') {
          totalReimbursements += adj.amount
        }
      }
      
      // Update paystub
      const updatedPaystub = await prisma.paystub.update({
        where: { id: paystub.id },
        data: {
          totalDeductions,
          netPay: paystub.grossPay + totalReimbursements - totalDeductions,
          modifiedDate: todayISO()
        }
      })
      
      updatedPaystubs.push({
        id: updatedPaystub.id,
        employeeName: updatedPaystub.employeeName,
        periodName: period.periodName,
        oldNetPay: paystub.netPay,
        newNetPay: updatedPaystub.netPay,
        adjustment: updatedPaystub.netPay - paystub.netPay
      })
      
      if (!affectedPeriods.find(p => p.id === period.id)) {
        affectedPeriods.push({
          id: period.id,
          periodName: period.periodName,
          startDate: period.startDate,
          endDate: period.endDate
        })
      }
    }
  }
  
  console.log(`✅ Load deletion processing complete: ${updatedPaystubs.length} paystubs updated`)
  
  return { updatedPaystubs, affectedPeriods }
}

// Handle load modification - recalculate affected paystubs
async function handleLoadModified(loadData: any, reason: string) {
  console.log(`📝 Handling modification of load ${loadData.loadNumber}`)
  
  // For load modifications, we would typically:
  // 1. Find affected paystubs
  // 2. Recalculate driver pay based on new load data
  // 3. Update paystub totals
  
  // Simplified implementation - would need full recalculation logic
  return { updatedPaystubs: [], affectedPeriods: [] }
}

// Handle load status change - update payroll eligibility
async function handleLoadStatusChanged(loadData: any, reason: string) {
  console.log(`🔄 Handling status change of load ${loadData.loadNumber} to ${loadData.status}`)
  
  // When a load status changes to/from DELIVERED, it affects payroll eligibility
  // This would trigger recalculation of affected payroll periods
  
  return { updatedPaystubs: [], affectedPeriods: [] }
}

// GET /api/payroll/load-updates - Get load update history
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const loadNumber = searchParams.get('loadNumber')
    const employeeId = searchParams.get('employeeId')
    const days = parseInt(searchParams.get('days') || '30')
    
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)
    
    const where: any = {
      createdDate: { gte: startDate.toISOString() }
    }
    
    if (loadNumber) {
      where.loadNumber = loadNumber
    }
    
    if (employeeId) {
      where.employeeId = parseInt(employeeId)
    }
    
    // Get recent adjustments related to load updates
    const adjustments = await prisma.payrollAdjustment.findMany({
      where,
      include: {
        paystub: {
          include: {
            payrollPeriod: true
          }
        }
      },
      orderBy: { createdDate: 'desc' }
    })
    
    return NextResponse.json({
      adjustments: adjustments.map(adj => ({
        id: adj.id,
        loadNumber: adj.loadNumber,
        employeeId: adj.employeeId,
        category: adj.category,
        adjustmentType: adj.adjustmentType,
        adjustmentName: adj.adjustmentName,
        description: adj.description,
        amount: adj.amount,
        status: adj.status,
        createdDate: adj.createdDate,
        createdBy: adj.createdBy,
        periodName: adj.paystub?.payrollPeriod?.periodName,
        reverseReason: adj.reverseReason
      }))
    })
    
  } catch (error) {
    console.error('Error fetching load update history:', error)
    return NextResponse.json(
      { error: 'Failed to fetch load update history' },
      { status: 500 }
    )
  }
}
