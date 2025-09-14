import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { auth } from '@clerk/nextjs'

const prisma = new PrismaClient()

/**
 * Comprehensive Individual Payroll Management API
 * Handles employee-centric payroll processing with IndividualPayroll model
 * Integrates all payroll components: loads, adjustments, advances, escrow, fuel, etc.
 */

export async function GET(request: NextRequest) {
  try {
    const { userId } = auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const employeeId = searchParams.get('employeeId');
    const weekStartDate = searchParams.get('weekStartDate');
    const status = searchParams.get('status');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const includeDetails = searchParams.get('includeDetails') === 'true';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    console.log('💼 Comprehensive Payroll - GET request', {
      employeeId,
      weekStartDate,
      status,
      dateFrom,
      dateTo,
      includeDetails,
      page,
      limit
    });

    // Build where clause
    const where: any = {};
    if (employeeId) where.employeeId = parseInt(employeeId);
    if (weekStartDate) where.weekStartDate = weekStartDate;
    if (status) where.status = status;
    if (dateFrom || dateTo) {
      where.weekStartDate = {};
      if (dateFrom) where.weekStartDate.gte = dateFrom;
      if (dateTo) where.weekStartDate.lte = dateTo;
    }

    // Get individual payroll records
    const [payrolls, total] = await Promise.all([
      prisma.individualPayroll.findMany({
        where,
        include: includeDetails ? {
          loads: true,
          adjustments: {
            where: { status: { in: ['ACTIVE', 'APPROVED'] } }
          },
          paystub: {
            include: {
              deductions: true,
              reimbursementRecords: true,
              advances: true,
              escrowTransactions: true
            }
          },
          fuelIntegrations: {
            where: { isIncluded: true }
          }
        } : {
          paystub: {
            select: {
              id: true,
              status: true,
              generatedDate: true,
              paidDate: true
            }
          }
        },
        orderBy: [
          { weekStartDate: 'desc' },
          { employeeName: 'asc' }
        ],
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.individualPayroll.count({ where })
    ]);

    console.log(`✅ Found ${payrolls.length} payroll records (total: ${total})`);

    // Calculate summary statistics
    const statistics = await calculatePayrollStatistics(where);

    return NextResponse.json({
      success: true,
      data: {
        payrolls,
        statistics,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page * limit < total,
          hasPrevious: page > 1
        },
        statusOptions: ['DRAFT', 'CALCULATED', 'REVIEWED', 'PROCESSED', 'PAID']
      }
    });

  } catch (error) {
    console.error('❌ Comprehensive Payroll GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch payroll records', details: error instanceof Error ? error.message : 'Unknown error' },
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
      weekStartDate,
      weekEndDate = calculateWeekEndDate(weekStartDate),
      payDate,
      autoIncludeLoads = true,
      autoCalculate = true
    } = body;

    if (!employeeId || !weekStartDate) {
      return NextResponse.json({ 
        error: 'Missing required fields: employeeId, weekStartDate' 
      }, { status: 400 });
    }

    console.log('💼 Comprehensive Payroll - POST request (create/update)', {
      employeeId,
      weekStartDate,
      weekEndDate,
      autoIncludeLoads,
      autoCalculate
    });

    // Check if payroll already exists for this employee/week
    const existingPayroll = await prisma.individualPayroll.findUnique({
      where: {
        employeeId_weekStartDate: {
          employeeId: parseInt(employeeId),
          weekStartDate
        }
      }
    });

    if (existingPayroll) {
      return NextResponse.json({ 
        error: 'Payroll already exists for this employee and week' 
      }, { status: 400 });
    }

    // Get employee details
    const employee = await prisma.employee.findUnique({
      where: { id: parseInt(employeeId) }
    });

    if (!employee) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    }

    // Create comprehensive payroll record
    const result = await createComprehensivePayroll(
      employee,
      weekStartDate,
      weekEndDate,
      payDate,
      autoIncludeLoads,
      autoCalculate,
      userId
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    console.log(`✅ Successfully created payroll for ${employee.name} week ${weekStartDate}`);

    return NextResponse.json({
      success: true,
      message: 'Payroll record created successfully',
      data: result.payroll
    });

  } catch (error) {
    console.error('❌ Comprehensive Payroll POST error:', error);
    return NextResponse.json(
      { error: 'Failed to create payroll record', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { userId } = auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      id,
      status,
      notes,
      payDate,
      bonusAmount,
      reimbursements,
      overtime,
      otherEarnings,
      recalculate = false
    } = body;

    if (!id) {
      return NextResponse.json({ error: 'Payroll ID is required' }, { status: 400 });
    }

    console.log('💼 Comprehensive Payroll - PUT request', { id, status, recalculate });

    // Get existing payroll
    const existingPayroll = await prisma.individualPayroll.findUnique({
      where: { id: parseInt(id) },
      include: {
        loads: true,
        adjustments: true,
        fuelIntegrations: true
      }
    });

    if (!existingPayroll) {
      return NextResponse.json({ error: 'Payroll record not found' }, { status: 404 });
    }

    // Check if payroll is locked
    if (existingPayroll.isLocked && status !== 'PAID') {
      return NextResponse.json({ error: 'Payroll is locked and cannot be modified' }, { status: 400 });
    }

    let updatedData: any = {
      modifiedDate: new Date().toISOString()
    };

    // Handle status changes with appropriate tracking
    if (status && status !== existingPayroll.status) {
      updatedData.status = status;
      
      switch (status) {
        case 'CALCULATED':
          updatedData.calculatedDate = new Date().toISOString();
          updatedData.calculatedBy = userId;
          break;
        case 'REVIEWED':
          updatedData.reviewedDate = new Date().toISOString();
          updatedData.reviewedBy = userId;
          break;
        case 'PROCESSED':
          updatedData.processedDate = new Date().toISOString();
          updatedData.processedBy = userId;
          updatedData.isLocked = true; // Lock when processed
          break;
        case 'PAID':
          updatedData.isLocked = true; // Ensure locked when paid
          break;
      }
    }

    // Handle field updates
    if (notes !== undefined) updatedData.notes = notes;
    if (payDate !== undefined) updatedData.payDate = payDate;
    if (bonusAmount !== undefined) updatedData.bonusAmount = bonusAmount;
    if (reimbursements !== undefined) updatedData.reimbursements = reimbursements;
    if (overtime !== undefined) updatedData.overtime = overtime;
    if (otherEarnings !== undefined) updatedData.otherEarnings = otherEarnings;

    // Recalculate if requested
    if (recalculate) {
      const recalculatedData = await recalculatePayroll(existingPayroll);
      updatedData = { ...updatedData, ...recalculatedData };
    }

    // Update the payroll
    const updated = await prisma.individualPayroll.update({
      where: { id: parseInt(id) },
      data: updatedData,
      include: {
        loads: true,
        adjustments: true,
        paystub: true
      }
    });

    // If status changed to PROCESSED or PAID, update paystub if it exists
    if ((status === 'PROCESSED' || status === 'PAID') && updated.paystub) {
      await prisma.paystub.update({
        where: { id: updated.paystub.id },
        data: {
          status: status === 'PROCESSED' ? 'APPROVED' : 'PAID',
          approvedDate: status === 'PROCESSED' ? new Date().toISOString() : updated.paystub.approvedDate,
          paidDate: status === 'PAID' ? new Date().toISOString() : updated.paystub.paidDate
        }
      });
    }

    console.log(`✅ Successfully updated payroll ID ${id}`);

    return NextResponse.json({
      success: true,
      message: 'Payroll record updated successfully',
      data: updated
    });

  } catch (error) {
    console.error('❌ Comprehensive Payroll PUT error:', error);
    
    if (error instanceof Error && 'code' in error && error.code === 'P2025') {
      return NextResponse.json({ error: 'Payroll record not found' }, { status: 404 });
    }
    
    return NextResponse.json(
      { error: 'Failed to update payroll record', details: error instanceof Error ? error.message : 'Unknown error' },
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
    const id = searchParams.get('id');
    const reason = searchParams.get('reason') || 'Payroll deleted by admin';

    if (!id) {
      return NextResponse.json({ error: 'Payroll ID is required' }, { status: 400 });
    }

    console.log('💼 Comprehensive Payroll - DELETE request', { id, reason });

    // Get payroll record
    const payroll = await prisma.individualPayroll.findUnique({
      where: { id: parseInt(id) },
      include: {
        paystub: true,
        loads: true,
        adjustments: true
      }
    });

    if (!payroll) {
      return NextResponse.json({ error: 'Payroll record not found' }, { status: 404 });
    }

    // Check if payroll can be deleted
    if (payroll.status === 'PAID') {
      return NextResponse.json({ 
        error: 'Cannot delete paid payroll. Please contact administrator.' 
      }, { status: 400 });
    }

    if (payroll.isLocked) {
      return NextResponse.json({ 
        error: 'Cannot delete locked payroll. Please unlock first.' 
      }, { status: 400 });
    }

    // Delete payroll and related records
    await prisma.$transaction(async (tx) => {
      // Delete paystub and its related records if it exists
      if (payroll.paystub) {
        await tx.payrollDeduction.deleteMany({
          where: { paystubId: payroll.paystub.id }
        });
        await tx.payrollReimbursement.deleteMany({
          where: { paystubId: payroll.paystub.id }
        });
        await tx.payrollEscrowTransaction.deleteMany({
          where: { paystubId: payroll.paystub.id }
        });
        await tx.paystub.delete({
          where: { id: payroll.paystub.id }
        });
      }

      // Delete payroll loads
      await tx.payrollLoad.deleteMany({
        where: { payrollId: payroll.id }
      });

      // Delete adjustments linked to this payroll
      await tx.payrollAdjustment.deleteMany({
        where: { payrollId: payroll.id }
      });

      // Delete fuel integrations
      await tx.payrollFuelIntegration.deleteMany({
        where: { payrollId: payroll.id }
      });

      // Delete the main payroll record
      await tx.individualPayroll.delete({
        where: { id: parseInt(id) }
      });
    });

    console.log(`✅ Successfully deleted payroll ID ${id}`);

    return NextResponse.json({
      success: true,
      message: 'Payroll record deleted successfully'
    });

  } catch (error) {
    console.error('❌ Comprehensive Payroll DELETE error:', error);
    
    if (error instanceof Error && 'code' in error && error.code === 'P2025') {
      return NextResponse.json({ error: 'Payroll record not found' }, { status: 404 });
    }
    
    return NextResponse.json(
      { error: 'Failed to delete payroll record', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * Create comprehensive payroll record with all integrations
 */
async function createComprehensivePayroll(
  employee: any,
  weekStartDate: string,
  weekEndDate: string,
  payDate: string | null,
  autoIncludeLoads: boolean,
  autoCalculate: boolean,
  userId: string
): Promise<{ success: boolean; payroll?: any; error?: string }> {

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Create initial payroll record
      const payroll = await tx.individualPayroll.create({
        data: {
          employeeId: employee.id,
          employeeName: employee.name,
          weekStartDate,
          weekEndDate,
          payDate: payDate || null,
          totalLoads: 0,
          totalMiles: 0,
          grossRevenue: 0,
          paymentMethod: employee.paymentMethod || 'PERCENTAGE',
          basePayRate: 0,
          basePay: 0,
          bonusAmount: 0,
          reimbursements: 0,
          overtime: 0,
          otherEarnings: 0,
          totalDeductions: 0,
          fuelDeductions: 0,
          advanceRepayments: 0,
          otherDeductions: 0,
          grossPay: 0,
          netPay: 0,
          status: 'DRAFT',
          isLocked: false,
          createdDate: new Date().toISOString(),
          createdBy: userId
        }
      });

      // Auto-include loads if requested
      if (autoIncludeLoads) {
        await includeLoadsInPayroll(tx, payroll.id, employee.id, weekStartDate, weekEndDate);
      }

      // Auto-include fuel transactions
      await includeFuelInPayroll(tx, payroll.id, employee.id, weekStartDate, weekEndDate);

      // Auto-calculate if requested
      if (autoCalculate) {
        const calculatedData = await calculatePayrollData(tx, payroll.id);
        
        await tx.individualPayroll.update({
          where: { id: payroll.id },
          data: {
            ...calculatedData,
            status: 'CALCULATED',
            calculatedDate: new Date().toISOString(),
            calculatedBy: userId
          }
        });
      }

      return await tx.individualPayroll.findUnique({
        where: { id: payroll.id },
        include: {
          loads: true,
          adjustments: true,
          fuelIntegrations: true
        }
      });
    });

    return { success: true, payroll: result };

  } catch (error) {
    return { 
      success: false, 
      error: `Failed to create payroll: ${error instanceof Error ? error.message : 'Unknown error'}` 
    };
  }
}

/**
 * Include loads in payroll
 */
async function includeLoadsInPayroll(
  tx: any,
  payrollId: number,
  employeeId: number,
  weekStartDate: string,
  weekEndDate: string
): Promise<void> {
  // Get delivered loads for the week
  const loads = await tx.load.findMany({
    where: {
      driverId: employeeId,
      status: 'DELIVERED',
      deliveryDate: {
        gte: weekStartDate,
        lte: weekEndDate
      }
    }
  });

  // Create PayrollLoad records
  for (const load of loads) {
    await tx.payrollLoad.create({
      data: {
        payrollId,
        loadId: load.id,
        loadNumber: load.loadNumber,
        grossAmount: load.grossAmount,
        driverRate: load.driverRate || 0,
        finalMiles: load.finalMiles || 0,
        deliveryDate: load.deliveryDate,
        paymentMethod: load.paymentMethod,
        payPerMileRate: load.payPerMileRate || 0,
        driverPercent: load.driverPercent || 0, // This would need to be added to Load model
        isIncluded: true,
        createdDate: new Date().toISOString()
      }
    });
  }
}

/**
 * Include fuel transactions in payroll
 */
async function includeFuelInPayroll(
  tx: any,
  payrollId: number,
  employeeId: number,
  weekStartDate: string,
  weekEndDate: string
): Promise<void> {
  // Get fuel transactions for the week
  const fuelTransactions = await tx.fuelTransaction.findMany({
    where: {
      employeeId,
      tranDate: {
        gte: weekStartDate,
        lte: weekEndDate
      }
    }
  });

  // Create PayrollFuelIntegration records
  for (const fuel of fuelTransactions) {
    await tx.payrollFuelIntegration.create({
      data: {
        payrollId,
        fuelTransactionId: fuel.id,
        employeeId,
        fuelInvoice: fuel.invoice,
        fuelAmount: fuel.amt + fuel.fees,
        fuelDate: fuel.tranDate,
        location: fuel.locationName,
        weekStartDate,
        isIncluded: true,
        deductionAmount: fuel.amt + fuel.fees,
        createdDate: new Date().toISOString()
      }
    });
  }
}

/**
 * Calculate payroll data based on included loads and deductions
 */
async function calculatePayrollData(tx: any, payrollId: number): Promise<any> {
  // Get payroll with all related data
  const payroll = await tx.individualPayroll.findUnique({
    where: { id: payrollId },
    include: {
      loads: { where: { isIncluded: true } },
      adjustments: { where: { status: { in: ['ACTIVE', 'APPROVED'] } } },
      fuelIntegrations: { where: { isIncluded: true } }
    }
  });

  if (!payroll) throw new Error('Payroll not found');

  // Calculate load-based earnings
  const totalLoads = payroll.loads.length;
  const totalMiles = payroll.loads.reduce((sum, load) => sum + load.finalMiles, 0);
  const grossRevenue = payroll.loads.reduce((sum, load) => sum + load.grossAmount, 0);

  // Calculate base pay based on payment method
  let basePay = 0;
  const basePayRate = payroll.basePayRate || 0;

  switch (payroll.paymentMethod) {
    case 'PAY_PER_MILE':
      basePay = totalMiles * basePayRate;
      break;
    case 'FLAT_RATE':
      basePay = payroll.loads.reduce((sum, load) => sum + load.driverRate, 0);
      break;
    case 'PERCENTAGE':
    default:
      basePay = grossRevenue * (basePayRate / 100);
      break;
  }

  // Calculate deductions
  const fuelDeductions = payroll.fuelIntegrations.reduce((sum, fuel) => sum + fuel.deductionAmount, 0);
  const otherDeductions = payroll.adjustments
    .filter(adj => adj.category === 'DEDUCTION')
    .reduce((sum, adj) => sum + adj.amount, 0);
  
  // Calculate reimbursements and bonuses
  const adjustmentReimbursements = payroll.adjustments
    .filter(adj => adj.category === 'REIMBURSEMENT')
    .reduce((sum, adj) => sum + adj.amount, 0);

  // Calculate totals
  const totalDeductions = fuelDeductions + otherDeductions;
  const totalReimbursements = payroll.reimbursements + adjustmentReimbursements;
  const grossPay = basePay + payroll.bonusAmount + payroll.overtime + payroll.otherEarnings + totalReimbursements;
  const netPay = grossPay - totalDeductions - payroll.advanceRepayments;

  return {
    totalLoads,
    totalMiles,
    grossRevenue,
    basePay,
    totalDeductions,
    fuelDeductions,
    otherDeductions,
    reimbursements: totalReimbursements,
    grossPay,
    netPay
  };
}

/**
 * Recalculate existing payroll
 */
async function recalculatePayroll(payroll: any): Promise<any> {
  return await prisma.$transaction(async (tx) => {
    return await calculatePayrollData(tx, payroll.id);
  });
}

/**
 * Calculate week end date from start date
 */
function calculateWeekEndDate(weekStartDate: string): string {
  const start = new Date(weekStartDate);
  const end = new Date(start);
  end.setDate(start.getDate() + 6); // Sunday
  return end.toISOString().split('T')[0];
}

/**
 * Calculate payroll statistics
 */
async function calculatePayrollStatistics(where: any): Promise<any> {
  const [
    totalPayrolls,
    draftPayrolls,
    calculatedPayrolls,
    reviewedPayrolls,
    processedPayrolls,
    paidPayrolls,
    totalGrossResult,
    totalNetResult
  ] = await Promise.all([
    prisma.individualPayroll.count({ where }),
    prisma.individualPayroll.count({ where: { ...where, status: 'DRAFT' } }),
    prisma.individualPayroll.count({ where: { ...where, status: 'CALCULATED' } }),
    prisma.individualPayroll.count({ where: { ...where, status: 'REVIEWED' } }),
    prisma.individualPayroll.count({ where: { ...where, status: 'PROCESSED' } }),
    prisma.individualPayroll.count({ where: { ...where, status: 'PAID' } }),
    prisma.individualPayroll.aggregate({
      where,
      _sum: { grossPay: true }
    }),
    prisma.individualPayroll.aggregate({
      where,
      _sum: { netPay: true }
    })
  ]);

  return {
    totalPayrolls,
    byStatus: {
      draft: draftPayrolls,
      calculated: calculatedPayrolls,
      reviewed: reviewedPayrolls,
      processed: processedPayrolls,
      paid: paidPayrolls
    },
    financials: {
      totalGross: totalGrossResult._sum.grossPay || 0,
      totalNet: totalNetResult._sum.netPay || 0,
      averageGross: totalPayrolls > 0 ? (totalGrossResult._sum.grossPay || 0) / totalPayrolls : 0,
      averageNet: totalPayrolls > 0 ? (totalNetResult._sum.netPay || 0) / totalPayrolls : 0
    }
  };
}
