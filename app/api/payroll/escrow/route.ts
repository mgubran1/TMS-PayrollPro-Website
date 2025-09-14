import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/payroll/escrow - Get all escrow accounts
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const employeeId = searchParams.get('employeeId')
    const includeTransactions = searchParams.get('includeTransactions') === 'true'

    // Build where clause
    const where: any = {}
    if (employeeId) {
      where.employeeId = parseInt(employeeId)
    }

    // Get escrow accounts
    const accounts = await prisma.payrollEscrow.findMany({
      where,
      include: {
        deposits: includeTransactions ? {
          orderBy: { transactionDate: 'desc' },
          take: 50 // Limit transactions for performance
        } : false
      },
      orderBy: {
        employeeName: 'asc'
      }
    })

    // Calculate summary statistics
    const summary = {
      totalAccounts: accounts.length,
      activeAccounts: accounts.filter(acc => acc.isActive).length,
      fundedAccounts: accounts.filter(acc => acc.isFunded).length,
      totalBalance: accounts.reduce((sum, acc) => sum + acc.currentBalance, 0),
      totalTarget: accounts.reduce((sum, acc) => sum + acc.targetAmount, 0),
      averageBalance: accounts.length > 0 ? accounts.reduce((sum, acc) => sum + acc.currentBalance, 0) / accounts.length : 0
    }

    return NextResponse.json({
      accounts,
      summary
    })

  } catch (error) {
    console.error('Error fetching escrow accounts:', error)
    return NextResponse.json(
      { error: 'Failed to fetch escrow accounts' },
      { status: 500 }
    )
  }
}

// POST /api/payroll/escrow - Create new escrow account
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      employeeId,
      employeeName,
      targetAmount,
      weeklyAmount,
      autoDeposit,
      maxWeeklyDeposit,
      minWeeklyDeposit,
      targetWeeks,
      createdBy
    } = body

    // Validate required fields
    if (!employeeId || !targetAmount || !weeklyAmount) {
      return NextResponse.json(
        { error: 'Missing required fields: employeeId, targetAmount, weeklyAmount' },
        { status: 400 }
      )
    }

    // Check if employee already has an escrow account
    const existingAccount = await prisma.payrollEscrow.findUnique({
      where: { employeeId }
    })

    if (existingAccount) {
      return NextResponse.json(
        { error: 'Employee already has an escrow account' },
        { status: 409 }
      )
    }

    // Get employee name if not provided
    let finalEmployeeName = employeeName
    if (!finalEmployeeName) {
      const employee = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { name: true }
      })
      finalEmployeeName = employee?.name || 'Unknown'
    }

    // Create escrow account
    const escrowAccount = await prisma.payrollEscrow.create({
      data: {
        employeeId,
        employeeName: finalEmployeeName,
        currentBalance: 0,
        targetAmount,
        weeklyAmount,
        isFunded: false,
        isActive: true,
        autoDeposit: autoDeposit || false,
        maxWeeklyDeposit: maxWeeklyDeposit || 500,
        minWeeklyDeposit: minWeeklyDeposit || 50,
        targetWeeks: targetWeeks || 6,
        createdDate: new Date().toISOString(),
        createdBy: createdBy || 'system'
      }
    })

    console.log(`Created escrow account for employee ${employeeId}: Target $${targetAmount}, Weekly $${weeklyAmount}`)

    return NextResponse.json({
      success: true,
      account: escrowAccount,
      message: 'Escrow account created successfully'
    })

  } catch (error) {
    console.error('Error creating escrow account:', error)
    return NextResponse.json(
      { error: 'Failed to create escrow account' },
      { status: 500 }
    )
  }
}

// PUT /api/payroll/escrow - Update escrow account
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      id,
      targetAmount,
      weeklyAmount,
      autoDeposit,
      maxWeeklyDeposit,
      minWeeklyDeposit,
      targetWeeks,
      isActive
    } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Escrow account ID is required' },
        { status: 400 }
      )
    }

    // Update escrow account
    const updatedAccount = await prisma.payrollEscrow.update({
      where: { id },
      data: {
        targetAmount: targetAmount !== undefined ? targetAmount : undefined,
        weeklyAmount: weeklyAmount !== undefined ? weeklyAmount : undefined,
        autoDeposit: autoDeposit !== undefined ? autoDeposit : undefined,
        maxWeeklyDeposit: maxWeeklyDeposit !== undefined ? maxWeeklyDeposit : undefined,
        minWeeklyDeposit: minWeeklyDeposit !== undefined ? minWeeklyDeposit : undefined,
        targetWeeks: targetWeeks !== undefined ? targetWeeks : undefined,
        isActive: isActive !== undefined ? isActive : undefined,
        modifiedDate: new Date().toISOString()
      }
    })

    console.log(`Updated escrow account ${id}`)

    return NextResponse.json({
      success: true,
      account: updatedAccount,
      message: 'Escrow account updated successfully'
    })

  } catch (error) {
    console.error('Error updating escrow account:', error)
    return NextResponse.json(
      { error: 'Failed to update escrow account' },
      { status: 500 }
    )
  }
}

// DELETE /api/payroll/escrow - Delete escrow account
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = parseInt(searchParams.get('id') || '0')

    if (!id) {
      return NextResponse.json(
        { error: 'Escrow account ID is required' },
        { status: 400 }
      )
    }

    // Check if account has any transactions
    const transactionCount = await prisma.payrollEscrowTransaction.count({
      where: { escrowId: id }
    })

    if (transactionCount > 0) {
      return NextResponse.json(
        { error: 'Cannot delete escrow account with existing transactions. Set to inactive instead.' },
        { status: 400 }
      )
    }

    // Delete the account
    await prisma.payrollEscrow.delete({
      where: { id }
    })

    console.log(`Deleted escrow account ${id}`)

    return NextResponse.json({
      success: true,
      message: 'Escrow account deleted successfully'
    })

  } catch (error) {
    console.error('Error deleting escrow account:', error)
    return NextResponse.json(
      { error: 'Failed to delete escrow account' },
      { status: 500 }
    )
  }
}