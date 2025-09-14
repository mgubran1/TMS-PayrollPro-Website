import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { auth } from '@clerk/nextjs'

const prisma = new PrismaClient()

/**
 * Payroll Escrow Transactions API - Handles deposits, withdrawals, and adjustments
 * Based on Java PayrollEscrow transaction management
 */

export async function GET(request: NextRequest) {
  try {
    const { userId } = auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const employeeId = searchParams.get('employeeId');
    const escrowId = searchParams.get('escrowId');
    const transactionType = searchParams.get('transactionType');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const weekStartDate = searchParams.get('weekStartDate');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    console.log('🏦 EscrowTransactions - GET request', {
      employeeId,
      escrowId,
      transactionType,
      dateFrom,
      dateTo,
      weekStartDate,
      page,
      limit
    });

    // Build where clause
    const where: any = {};
    if (employeeId) where.employeeId = parseInt(employeeId);
    if (escrowId) where.escrowId = parseInt(escrowId);
    if (transactionType) where.transactionType = transactionType;
    if (weekStartDate) where.weekStartDate = weekStartDate;
    if (dateFrom || dateTo) {
      where.transactionDate = {};
      if (dateFrom) where.transactionDate.gte = dateFrom;
      if (dateTo) where.transactionDate.lte = dateTo;
    }

    // Get transactions with pagination
    const [transactions, total] = await Promise.all([
      prisma.payrollEscrowTransaction.findMany({
        where,
        include: {
          escrow: {
            select: {
              id: true,
              employeeName: true,
              targetAmount: true,
              currentBalance: true
            }
          },
          paystub: {
            select: {
              id: true,
              weekStartDate: true,
              weekEndDate: true,
              netPay: true
            }
          }
        },
        orderBy: { transactionDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.payrollEscrowTransaction.count({ where })
    ]);

    console.log(`✅ Found ${transactions.length} escrow transactions (total: ${total})`);

    // Calculate summary statistics
    const statistics = await calculateTransactionStatistics(where);

    return NextResponse.json({
      success: true,
      data: {
        transactions,
        statistics,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page * limit < total,
          hasPrevious: page > 1
        },
        transactionTypes: ['DEPOSIT', 'WITHDRAWAL', 'ADJUSTMENT', 'INTEREST']
      }
    });

  } catch (error) {
    console.error('❌ EscrowTransactions GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch escrow transactions', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      employeeId,
      transactionType, // DEPOSIT, WITHDRAWAL, ADJUSTMENT, INTEREST
      amount,
      description,
      transactionDate = new Date().toISOString().split('T')[0],
      effectiveDate = transactionDate,
      weekStartDate,
      authorizedBy = userId,
      reason,
      paystubId
    } = body;

    if (!employeeId || !transactionType || !amount) {
      return NextResponse.json({ 
        error: 'Missing required fields: employeeId, transactionType, amount' 
      }, { status: 400 });
    }

    if (!['DEPOSIT', 'WITHDRAWAL', 'ADJUSTMENT', 'INTEREST'].includes(transactionType)) {
      return NextResponse.json({ 
        error: 'Invalid transaction type. Must be: DEPOSIT, WITHDRAWAL, ADJUSTMENT, or INTEREST' 
      }, { status: 400 });
    }

    console.log('🏦 EscrowTransactions - POST request', {
      employeeId,
      transactionType,
      amount,
      transactionDate
    });

    // Get escrow account
    const escrowAccount = await prisma.payrollEscrow.findUnique({
      where: { employeeId: parseInt(employeeId) }
    });

    if (!escrowAccount) {
      return NextResponse.json({ error: 'Escrow account not found for this employee' }, { status: 404 });
    }

    if (!escrowAccount.isActive) {
      return NextResponse.json({ error: 'Escrow account is not active' }, { status: 400 });
    }

    // Validate transaction based on type
    const validationResult = validateTransaction(transactionType, amount, escrowAccount.currentBalance);
    if (!validationResult.valid) {
      return NextResponse.json({ error: validationResult.error }, { status: 400 });
    }

    // Process the transaction
    const result = await processEscrowTransaction(
      escrowAccount,
      transactionType,
      amount,
      description || '',
      transactionDate,
      effectiveDate,
      weekStartDate,
      authorizedBy,
      reason,
      paystubId,
      userId
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    console.log(`✅ Successfully processed ${transactionType} transaction of $${Math.abs(amount)} for employee ${escrowAccount.employeeName}`);

    return NextResponse.json({
      success: true,
      message: `${transactionType} transaction processed successfully`,
      data: result.transaction
    });

  } catch (error) {
    console.error('❌ EscrowTransactions POST error:', error);
    return NextResponse.json(
      { error: 'Failed to process escrow transaction', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { userId } = auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const transactionId = searchParams.get('id');
    const reason = searchParams.get('reason') || 'Transaction deleted by admin';

    if (!transactionId) {
      return NextResponse.json({ error: 'Transaction ID is required' }, { status: 400 });
    }

    console.log('🏦 EscrowTransactions - DELETE request', { transactionId, reason });

    // Get transaction details
    const transaction = await prisma.payrollEscrowTransaction.findUnique({
      where: { id: parseInt(transactionId) },
      include: {
        escrow: true
      }
    });

    if (!transaction) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    // Reverse the transaction by creating an opposite transaction
    const reversalAmount = -transaction.amount;
    const newBalance = transaction.escrow.currentBalance + reversalAmount;

    if (newBalance < 0) {
      return NextResponse.json({ 
        error: 'Cannot reverse transaction: would result in negative balance' 
      }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      // Create reversal transaction
      await tx.payrollEscrowTransaction.create({
        data: {
          escrowId: transaction.escrowId,
          employeeId: transaction.employeeId,
          transactionType: 'ADJUSTMENT',
          amount: reversalAmount,
          description: `REVERSAL: ${transaction.description} - ${reason}`,
          balanceBefore: transaction.escrow.currentBalance,
          balanceAfter: newBalance,
          transactionDate: new Date().toISOString().split('T')[0],
          effectiveDate: new Date().toISOString().split('T')[0],
          authorizedBy: userId,
          reason: `Reversal of transaction ${transactionId}: ${reason}`,
          createdDate: new Date().toISOString(),
          createdBy: userId
        }
      });

      // Update escrow balance
      await tx.payrollEscrow.update({
        where: { id: transaction.escrowId },
        data: {
          currentBalance: newBalance,
          isFunded: newBalance >= transaction.escrow.targetAmount,
          modifiedDate: new Date().toISOString(),
          modifiedBy: userId
        }
      });
    });

    console.log(`✅ Successfully reversed transaction ID ${transactionId}`);

    return NextResponse.json({
      success: true,
      message: 'Transaction reversed successfully'
    });

  } catch (error) {
    console.error('❌ EscrowTransactions DELETE error:', error);
    return NextResponse.json(
      { error: 'Failed to reverse transaction', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * Validate transaction based on type and amount
 */
function validateTransaction(transactionType: string, amount: number, currentBalance: number): { valid: boolean; error?: string } {
  switch (transactionType) {
    case 'DEPOSIT':
    case 'INTEREST':
      if (amount <= 0) {
        return { valid: false, error: `${transactionType} amount must be positive` };
      }
      break;
    
    case 'WITHDRAWAL':
      if (amount <= 0) {
        return { valid: false, error: 'Withdrawal amount must be positive' };
      }
      if (amount > currentBalance) {
        return { valid: false, error: `Withdrawal amount ($${amount}) exceeds current balance ($${currentBalance})` };
      }
      break;
    
    case 'ADJUSTMENT':
      // Adjustments can be positive or negative, but not zero
      if (amount === 0) {
        return { valid: false, error: 'Adjustment amount cannot be zero' };
      }
      // Check if negative adjustment would result in negative balance
      if (amount < 0 && Math.abs(amount) > currentBalance) {
        return { valid: false, error: `Negative adjustment would result in negative balance` };
      }
      break;
    
    default:
      return { valid: false, error: 'Invalid transaction type' };
  }
  
  return { valid: true };
}

/**
 * Process escrow transaction with balance updates
 */
async function processEscrowTransaction(
  escrowAccount: any,
  transactionType: string,
  amount: number,
  description: string,
  transactionDate: string,
  effectiveDate: string,
  weekStartDate: string | null,
  authorizedBy: string,
  reason: string | null,
  paystubId: number | null,
  userId: string
): Promise<{ success: boolean; transaction?: any; error?: string }> {
  
  // Calculate transaction amount (positive for deposits, negative for withdrawals)
  let transactionAmount: number;
  switch (transactionType) {
    case 'DEPOSIT':
    case 'INTEREST':
      transactionAmount = Math.abs(amount);
      break;
    case 'WITHDRAWAL':
      transactionAmount = -Math.abs(amount);
      break;
    case 'ADJUSTMENT':
      transactionAmount = amount; // Can be positive or negative
      break;
    default:
      return { success: false, error: 'Invalid transaction type' };
  }

  const balanceBefore = escrowAccount.currentBalance;
  const balanceAfter = balanceBefore + transactionAmount;

  if (balanceAfter < 0) {
    return { success: false, error: 'Transaction would result in negative balance' };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Create transaction record
      const transaction = await tx.payrollEscrowTransaction.create({
        data: {
          escrowId: escrowAccount.id,
          employeeId: escrowAccount.employeeId,
          paystubId: paystubId || null,
          transactionType,
          amount: transactionAmount,
          description,
          balanceBefore,
          balanceAfter,
          transactionDate,
          effectiveDate,
          weekStartDate: weekStartDate || null,
          authorizedBy,
          reason: reason || null,
          createdDate: new Date().toISOString(),
          createdBy: userId
        }
      });

      // Update escrow account balance and funding status
      const isFunded = balanceAfter >= escrowAccount.targetAmount;
      const updateData: any = {
        currentBalance: balanceAfter,
        isFunded,
        lastDepositDate: transactionType === 'DEPOSIT' ? transactionDate : escrowAccount.lastDepositDate,
        modifiedDate: new Date().toISOString(),
        modifiedBy: userId
      };

      // Set fully funded date if this transaction makes it fully funded for the first time
      if (isFunded && !escrowAccount.isFunded && !escrowAccount.fullyFundedDate) {
        updateData.fullyFundedDate = new Date().toISOString();
      }

      await tx.payrollEscrow.update({
        where: { id: escrowAccount.id },
        data: updateData
      });

      return transaction;
    });

    return { success: true, transaction: result };

  } catch (error) {
    return { 
      success: false, 
      error: `Failed to process transaction: ${error instanceof Error ? error.message : 'Unknown error'}` 
    };
  }
}

/**
 * Calculate transaction statistics
 */
async function calculateTransactionStatistics(where: any): Promise<any> {
  const [
    totalTransactions,
    depositStats,
    withdrawalStats,
    adjustmentStats,
    interestStats
  ] = await Promise.all([
    prisma.payrollEscrowTransaction.count({ where }),
    prisma.payrollEscrowTransaction.aggregate({
      where: { ...where, transactionType: 'DEPOSIT' },
      _sum: { amount: true },
      _count: true
    }),
    prisma.payrollEscrowTransaction.aggregate({
      where: { ...where, transactionType: 'WITHDRAWAL' },
      _sum: { amount: true },
      _count: true
    }),
    prisma.payrollEscrowTransaction.aggregate({
      where: { ...where, transactionType: 'ADJUSTMENT' },
      _sum: { amount: true },
      _count: true
    }),
    prisma.payrollEscrowTransaction.aggregate({
      where: { ...where, transactionType: 'INTEREST' },
      _sum: { amount: true },
      _count: true
    })
  ]);

  return {
    totalTransactions,
    deposits: {
      count: depositStats._count,
      totalAmount: depositStats._sum.amount || 0
    },
    withdrawals: {
      count: withdrawalStats._count,
      totalAmount: Math.abs(withdrawalStats._sum.amount || 0)
    },
    adjustments: {
      count: adjustmentStats._count,
      totalAmount: adjustmentStats._sum.amount || 0
    },
    interest: {
      count: interestStats._count,
      totalAmount: interestStats._sum.amount || 0
    },
    netFlow: (depositStats._sum.amount || 0) + (withdrawalStats._sum.amount || 0) + (adjustmentStats._sum.amount || 0) + (interestStats._sum.amount || 0)
  };
}
