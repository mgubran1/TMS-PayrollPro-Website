import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { auth } from '@clerk/nextjs'
import { PayrollRow, PayrollSummaryStats } from '@/lib/types'

const prisma = new PrismaClient()

// Constants for calculations (from Java PayrollCalculator)
const HUNDRED = 100;
const TEN_PERCENT = 0.10;
const MIN_NET_PAY_THRESHOLD = 300;
const ESCROW_MIN_NET_PAY = 500;
const MAX_AUTO_REPAYMENT = 200;
const MAX_ESCROW_DEPOSIT = 500;
const MIN_ESCROW_DEPOSIT = 50;
const ESCROW_WEEKS_TARGET = 6;

/**
 * Comprehensive Payroll Calculator API - Direct port from Java PayrollCalculator.java
 * Handles all payroll calculations for drivers with BigDecimal precision and business logic
 */

export async function POST(request: NextRequest) {
  try {
    const { userId } = auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { 
      employeeIds, 
      startDate, 
      endDate, 
      periodType = 'WEEKLY',
      autoIncludeCurrentWeek = true,
      includeInactiveEmployees = false
    } = body;

    console.log('🔧 PayrollCalculator - Starting calculation', {
      employeeIds: employeeIds?.length || 'all',
      startDate,
      endDate,
      periodType,
      autoIncludeCurrentWeek
    });

    // Get employees
    let employees;
    if (employeeIds && employeeIds.length > 0) {
      employees = await prisma.employee.findMany({
        where: {
          id: { in: employeeIds },
          ...(includeInactiveEmployees ? {} : { status: 'ACTIVE' })
        },
        include: {
          paymentHistory: {
            where: {
              effectiveDate: { lte: endDate },
              OR: [
                { endDate: null },
                { endDate: { gte: startDate } }
              ]
            },
            orderBy: { effectiveDate: 'desc' },
            take: 1
          }
        }
      });
    } else {
      employees = await prisma.employee.findMany({
        where: includeInactiveEmployees ? {} : { status: 'ACTIVE' },
        include: {
          paymentHistory: {
            where: {
              effectiveDate: { lte: endDate },
              OR: [
                { endDate: null },
                { endDate: { gte: startDate } }
              ]
            },
            orderBy: { effectiveDate: 'desc' },
            take: 1
          }
        }
      });
    }

    console.log(`📊 Found ${employees.length} employees for payroll calculation`);

    // Calculate payroll rows
    const payrollRows: PayrollRow[] = [];
    
    for (const employee of employees) {
      try {
        console.log(`💰 Calculating payroll for ${employee.name} (ID: ${employee.id})`);
        const row = await calculateDriverPayroll(employee, startDate, endDate, autoIncludeCurrentWeek);
        payrollRows.push(row);
      } catch (error) {
        console.error(`❌ Error calculating payroll for ${employee.name}:`, error);
        // Add error row to maintain consistency
        payrollRows.push(createErrorRow(employee, error instanceof Error ? error.message : 'Unknown error'));
      }
    }

    // Calculate totals
    const totals = calculateTotals(payrollRows);
    
    console.log('✅ PayrollCalculator - Calculation complete', {
      rowsGenerated: payrollRows.length,
      totalGross: totals.gross,
      totalNet: totals.netPay
    });

    return NextResponse.json({
      success: true,
      data: {
        payrollRows,
        totals,
        summary: {
          employeeCount: payrollRows.length,
          periodType,
          startDate,
          endDate,
          calculationDate: new Date().toISOString(),
          calculatedBy: userId
        }
      }
    });

  } catch (error) {
    console.error('❌ PayrollCalculator API error:', error);
    return NextResponse.json(
      { error: 'Failed to calculate payroll', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * Calculate payroll for a single driver - Direct port from Java calculateDriverPayroll
 */
async function calculateDriverPayroll(
  employee: any, 
  startDate: string, 
  endDate: string, 
  autoIncludeCurrentWeek: boolean
): Promise<PayrollRow> {
  console.log(`🔍 Calculating payroll for ${employee.name} (${startDate} to ${endDate})`);

  // Get loads for the period
  const loads = await prisma.load.findMany({
    where: {
      driverId: employee.id,
      status: 'DELIVERED', // Only delivered loads count for payroll
      deliveryDate: {
        gte: startDate,
        lte: endDate
      }
    },
    orderBy: { deliveryDate: 'asc' }
  });

  console.log(`📦 Driver ${employee.name} - Found ${loads.length} delivered loads`);

  // Get fuel transactions for the period
  const fuels = await prisma.fuelTransaction.findMany({
    where: {
      employeeId: employee.id,
      tranDate: {
        gte: startDate,
        lte: endDate
      }
    },
    orderBy: { tranDate: 'asc' }
  });

  console.log(`⛽ Driver ${employee.name} - Found ${fuels.length} fuel transactions`);

  // Get effective payment configuration (use history if available, else current)
  const effectiveConfig = employee.paymentHistory?.[0] || {
    paymentMethod: employee.paymentMethod,
    driverPercent: employee.driverPercent,
    companyPercent: employee.companyPercent,
    serviceFeePercent: employee.serviceFeePercent,
    payPerMileRate: employee.payPerMileRate
  };

  console.log(`⚙️ Driver ${employee.name} - Using payment method: ${effectiveConfig.paymentMethod}`);

  // Calculate gross pay
  const gross = loads.reduce((total, load) => total + load.grossAmount, 0);
  console.log(`💵 Driver ${employee.name} - Gross from loads: $${gross.toFixed(2)}`);

  // Calculate fuel costs from transactions
  const fuelFromTransactions = fuels.reduce((total, fuel) => total + fuel.amt + fuel.fees, 0);
  
  // Get fuel deductions from adjustments
  const fuelAdjustments = await getFuelAdjustments(employee.id, startDate);
  const totalFuel = fuelFromTransactions + fuelAdjustments;
  
  console.log(`⛽ Driver ${employee.name} - Fuel: $${fuelFromTransactions.toFixed(2)} (transactions) + $${fuelAdjustments.toFixed(2)} (adjustments) = $${totalFuel.toFixed(2)}`);

  // Calculate service fee with bonus adjustments
  const serviceFeeAmt = (gross * effectiveConfig.serviceFeePercent) / HUNDRED;
  const grossAfterSF = gross - serviceFeeAmt;
  
  // Get bonuses for loads
  let totalBonus = 0;
  for (const load of loads) {
    const bonus = await getBonusForLoad(employee.id, startDate, load.loadNumber);
    totalBonus += bonus;
  }

  // Calculate company and driver pay based on payment method
  let companyPayAmt = 0;
  let driverPayAmt = 0;
  let finalMiles = 0;

  switch (effectiveConfig.paymentMethod) {
    case 'PAY_PER_MILE':
      // Calculate total miles and pay per mile
      finalMiles = loads.reduce((total, load) => total + (load.finalMiles || 0), 0);
      driverPayAmt = finalMiles * effectiveConfig.payPerMileRate;
      companyPayAmt = grossAfterSF - driverPayAmt;
      break;
    
    case 'FLAT_RATE':
      // For flat rate, driverRate is stored per load
      driverPayAmt = loads.reduce((total, load) => total + (load.driverRate || 0), 0);
      companyPayAmt = grossAfterSF - driverPayAmt;
      break;
    
    case 'PERCENTAGE':
    default:
      // Percentage-based calculation
      companyPayAmt = (grossAfterSF * effectiveConfig.companyPercent) / HUNDRED;
      driverPayAmt = (grossAfterSF * effectiveConfig.driverPercent) / HUNDRED;
      break;
  }

  const grossAfterFuel = grossAfterSF - totalFuel;

  // Calculate recurring fees
  const recurringFees = await getRecurringDeductions(employee.id, startDate);
  
  // Get cash advances
  const { advancesGiven, advanceRepayments } = await getAdvanceData(employee.id, startDate, endDate);
  
  // Get other deductions and reimbursements
  const otherDeductions = await getOtherDeductions(employee.id, startDate) - fuelAdjustments; // Exclude fuel to avoid double counting
  const reimbursements = await getTotalReimbursements(employee.id, startDate);
  const totalReimbursements = Math.abs(reimbursements) + Math.abs(totalBonus);

  // Calculate escrow deposits
  const escrowDeposits = await calculateEscrowDeposit(employee, startDate, gross, grossAfterFuel, recurringFees, advanceRepayments, otherDeductions, totalReimbursements);

  // Calculate final net pay - CORRECTED LOGIC (from Java)
  const driverGrossAfterFuel = driverPayAmt - Math.abs(totalFuel);
  const totalDeductions = Math.abs(recurringFees) + Math.abs(advanceRepayments) + Math.abs(escrowDeposits) + Math.abs(otherDeductions);
  const net = driverGrossAfterFuel - totalDeductions + totalReimbursements;
  const finalDriverPay = net;

  console.log(`📊 Driver ${employee.name} - Final calculation:
    Gross: $${gross.toFixed(2)}
    Service Fee: $${serviceFeeAmt.toFixed(2)}  
    Driver Share: $${driverPayAmt.toFixed(2)}
    Company Share: $${companyPayAmt.toFixed(2)}
    Fuel: $${totalFuel.toFixed(2)}
    Deductions: $${totalDeductions.toFixed(2)}
    Reimbursements: $${totalReimbursements.toFixed(2)}
    Final Net: $${finalDriverPay.toFixed(2)}`);

  // Create PayrollRow (matching Java PayrollRow structure)
  return {
    driverId: employee.id,
    driverName: employee.name,
    truckUnit: employee.truckUnit || '',
    loadCount: loads.length,
    gross,
    serviceFee: Math.abs(serviceFeeAmt),
    grossAfterServiceFee: grossAfterSF,
    companyPay: companyPayAmt,
    driverPay: finalDriverPay, // Final take-home pay (NET PAY)
    driverGrossShare: driverPayAmt, // Driver's share before final deductions
    fuel: Math.abs(totalFuel),
    grossAfterFuel,
    recurringFees: Math.abs(recurringFees),
    advancesGiven,
    advanceRepayments: Math.abs(advanceRepayments),
    escrowDeposits: Math.abs(escrowDeposits),
    otherDeductions: Math.abs(otherDeductions),
    reimbursements: totalReimbursements,
    netPay: finalDriverPay, // Same as driverPay
    loads,
    fuels,
    companyPercent: effectiveConfig.companyPercent,
    driverPercent: effectiveConfig.driverPercent,
    serviceFeePercent: effectiveConfig.serviceFeePercent
  };
}

/**
 * Helper functions for payroll calculations
 */

async function getFuelAdjustments(employeeId: number, weekStart: string): Promise<number> {
  // Get fuel-specific adjustments from PayrollAdjustment table
  const adjustments = await prisma.payrollAdjustment.findMany({
    where: {
      employeeId,
      category: 'DEDUCTION',
      adjustmentType: 'FUEL',
      status: { in: ['ACTIVE', 'APPROVED'] },
      weekStartDate: weekStart
    }
  });
  
  return adjustments.reduce((total, adj) => total + adj.amount, 0);
}

async function getBonusForLoad(employeeId: number, weekStart: string, loadNumber: string): Promise<number> {
  // Get load-specific bonuses
  const bonuses = await prisma.payrollAdjustment.findMany({
    where: {
      employeeId,
      category: 'REIMBURSEMENT',
      adjustmentType: 'BONUS',
      status: { in: ['ACTIVE', 'APPROVED'] },
      weekStartDate: weekStart,
      loadNumber
    }
  });
  
  return bonuses.reduce((total, bonus) => total + bonus.amount, 0);
}

async function getRecurringDeductions(employeeId: number, weekStart: string): Promise<number> {
  // Get recurring deductions for the week
  const recurring = await prisma.payrollRecurring.findMany({
    where: {
      driverId: employeeId, // Using driverId as in Java
      weekStart,
      isActive: true
    }
  });
  
  return recurring.reduce((total, deduction) => total + deduction.amount, 0);
}

async function getAdvanceData(employeeId: number, startDate: string, endDate: string): Promise<{ advancesGiven: number; advanceRepayments: number }> {
  // Get advances given during the period
  const advancesGiven = await prisma.payrollAdvance.findMany({
    where: {
      employeeId,
      advanceType: 'ADVANCE',
      advanceDate: { gte: startDate, lte: endDate }
    }
  });
  
  // Get repayments during the period
  const repayments = await prisma.payrollAdvance.findMany({
    where: {
      employeeId,
      advanceType: 'REPAYMENT',
      advanceDate: { gte: startDate, lte: endDate }
    }
  });
  
  const advancesGivenTotal = advancesGiven.reduce((total, adv) => total + adv.amount, 0);
  const advanceRepaymentsTotal = repayments.reduce((total, rep) => total + Math.abs(rep.amount), 0);
  
  return {
    advancesGiven: advancesGivenTotal,
    advanceRepayments: advanceRepaymentsTotal
  };
}

async function getOtherDeductions(employeeId: number, weekStart: string): Promise<number> {
  // Get other deductions (excluding fuel which is handled separately)
  const deductions = await prisma.payrollAdjustment.findMany({
    where: {
      employeeId,
      category: 'DEDUCTION',
      status: { in: ['ACTIVE', 'APPROVED'] },
      weekStartDate: weekStart,
      NOT: { adjustmentType: 'FUEL' } // Exclude fuel deductions
    }
  });
  
  return deductions.reduce((total, ded) => total + ded.amount, 0);
}

async function getTotalReimbursements(employeeId: number, weekStart: string): Promise<number> {
  // Get reimbursements (excluding bonuses which are handled separately)
  const reimbursements = await prisma.payrollAdjustment.findMany({
    where: {
      employeeId,
      category: 'REIMBURSEMENT',
      status: { in: ['ACTIVE', 'APPROVED'] },
      weekStartDate: weekStart,
      NOT: { adjustmentType: 'BONUS' } // Exclude bonuses
    }
  });
  
  return reimbursements.reduce((total, reimb) => total + reimb.amount, 0);
}

async function calculateEscrowDeposit(
  employee: any,
  weekStart: string,
  gross: number,
  grossAfterFuel: number,
  recurringFees: number,
  advanceRepayments: number,
  otherDeductions: number,
  reimbursements: number
): Promise<number> {
  // Get escrow account
  const escrow = await prisma.payrollEscrow.findUnique({
    where: { employeeId: employee.id }
  });
  
  if (!escrow || !escrow.isActive) return 0;
  
  // Check if escrow is fully funded
  if (escrow.currentBalance >= escrow.targetAmount) {
    console.log(`🏦 Driver ${employee.name} - Escrow fully funded, no deduction needed`);
    return 0;
  }
  
  // Check for manual weekly deposit
  const manualDeposit = escrow.weeklyAmount || 0;
  if (manualDeposit > 0) {
    console.log(`🏦 Driver ${employee.name} - Manual escrow deposit: $${manualDeposit.toFixed(2)}`);
    return manualDeposit;
  }
  
  // Calculate suggested deposit (but don't apply automatically)
  const remaining = Math.max(0, escrow.targetAmount - escrow.currentBalance);
  if (remaining > 0 && gross > 0) {
    const potentialNetBeforeEscrow = grossAfterFuel - Math.abs(recurringFees) - Math.abs(advanceRepayments) - Math.abs(otherDeductions) + Math.abs(reimbursements);
    
    if (potentialNetBeforeEscrow > ESCROW_MIN_NET_PAY) {
      const weeklyTarget = Math.ceil(remaining / ESCROW_WEEKS_TARGET);
      const maxEscrow = Math.min(weeklyTarget, MAX_ESCROW_DEPOSIT);
      const affordableEscrow = Math.max(0, potentialNetBeforeEscrow - ESCROW_MIN_NET_PAY);
      const suggestedEscrow = Math.min(maxEscrow, affordableEscrow);
      
      if (suggestedEscrow >= MIN_ESCROW_DEPOSIT) {
        console.log(`🏦 Driver ${employee.name} - SUGGESTED escrow deposit would be: $${suggestedEscrow.toFixed(2)} (NOT APPLIED - manual entry required)`);
      }
    }
  }
  
  // Return zero - no automatic escrow deduction without manual entry (as per Java logic)
  return 0;
}

/**
 * Create an error row for failed calculations - From Java createErrorRow
 */
function createErrorRow(employee: any, errorMessage: string): PayrollRow {
  return {
    driverId: employee.id,
    driverName: `${employee.name} (ERROR: ${errorMessage})`,
    truckUnit: employee.truckUnit || '',
    loadCount: 0,
    gross: 0,
    serviceFee: 0,
    grossAfterServiceFee: 0,
    companyPay: 0,
    driverPay: 0,
    driverGrossShare: 0,
    fuel: 0,
    grossAfterFuel: 0,
    recurringFees: 0,
    advancesGiven: 0,
    advanceRepayments: 0,
    escrowDeposits: 0,
    otherDeductions: 0,
    reimbursements: 0,
    netPay: 0,
    loads: [],
    fuels: [],
    companyPercent: 0,
    driverPercent: 0,
    serviceFeePercent: 0
  };
}

/**
 * Calculate totals from payroll rows - From Java calculateTotals
 */
function calculateTotals(rows: PayrollRow[]): { [key: string]: number } {
  const totals = {
    gross: rows.reduce((sum, r) => sum + r.gross, 0),
    serviceFee: rows.reduce((sum, r) => sum + r.serviceFee, 0),
    grossAfterServiceFee: rows.reduce((sum, r) => sum + r.grossAfterServiceFee, 0),
    companyPay: rows.reduce((sum, r) => sum + r.companyPay, 0),
    driverPay: rows.reduce((sum, r) => sum + r.driverPay, 0),
    fuel: rows.reduce((sum, r) => sum + r.fuel, 0),
    grossAfterFuel: rows.reduce((sum, r) => sum + r.grossAfterFuel, 0),
    recurringFees: rows.reduce((sum, r) => sum + r.recurringFees, 0),
    advancesGiven: rows.reduce((sum, r) => sum + r.advancesGiven, 0),
    advanceRepayments: rows.reduce((sum, r) => sum + r.advanceRepayments, 0),
    escrowDeposits: rows.reduce((sum, r) => sum + r.escrowDeposits, 0),
    otherDeductions: rows.reduce((sum, r) => sum + r.otherDeductions, 0),
    reimbursements: rows.reduce((sum, r) => sum + r.reimbursements, 0),
    netPay: rows.reduce((sum, r) => sum + r.netPay, 0)
  };
  
  console.log(`📊 Calculated totals for ${rows.length} rows: Gross=$${totals.gross.toFixed(2)}, Net=$${totals.netPay.toFixed(2)}`);
  
  return totals;
}
