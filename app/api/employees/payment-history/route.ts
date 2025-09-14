import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { todayISO } from '@/utils/dates';
import type { PaymentMethod } from '@/lib/types';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const employeeId = searchParams.get('employeeId');
    const effectiveDate = searchParams.get('effectiveDate');

    if (!employeeId) {
      return NextResponse.json({ error: 'Employee ID is required' }, { status: 400 });
    }

    if (effectiveDate) {
      // Get effective payment method for a specific date
      const effectivePayment = await getEffectivePaymentMethod(parseInt(employeeId), effectiveDate);
      return NextResponse.json(effectivePayment);
    } else {
      // Get all payment history for employee
      const history = await prisma.paymentMethodHistory.findMany({
        where: { employeeId: parseInt(employeeId) },
        orderBy: { effectiveDate: 'desc' }
      });
      return NextResponse.json(history);
    }
  } catch (error) {
    console.error('Error fetching payment history:', error);
    return NextResponse.json({ error: 'Failed to fetch payment history' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { 
      employeeId, 
      paymentMethod, 
      driverPercent, 
      companyPercent, 
      serviceFeePercent, 
      payPerMileRate, 
      effectiveDate, 
      note, 
      createdBy 
    } = body;

    if (!employeeId || !paymentMethod || !effectiveDate) {
      return NextResponse.json(
        { error: 'Employee ID, payment method, and effective date are required' }, 
        { status: 400 }
      );
    }

    // Start a transaction to ensure data consistency
    const result = await prisma.$transaction(async (tx) => {
      // End any current active payment method records
      await tx.paymentMethodHistory.updateMany({
        where: {
          employeeId: employeeId,
          endDate: null
        },
        data: {
          endDate: effectiveDate
        }
      });

      // Create new payment method record
      const newPaymentHistory = await tx.paymentMethodHistory.create({
        data: {
          employeeId: employeeId,
          paymentMethod: paymentMethod,
          driverPercent: driverPercent || 0,
          companyPercent: companyPercent || 0,
          serviceFeePercent: serviceFeePercent || 0,
          payPerMileRate: payPerMileRate || 0,
          effectiveDate: effectiveDate,
          endDate: null, // This will be the current active method
          note: note || null,
          createdBy: createdBy || 'system'
        }
      });

      // Update the employee's current payment method fields
      await tx.employee.update({
        where: { id: employeeId },
        data: {
          paymentMethod: paymentMethod,
          driverPercent: driverPercent || 0,
          companyPercent: companyPercent || 0,
          serviceFeePercent: serviceFeePercent || 0,
          payPerMileRate: payPerMileRate || 0,
          modifiedDate: todayISO(),
          modifiedBy: createdBy || 'system'
        }
      });

      return newPaymentHistory;
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('Error creating payment history:', error);
    return NextResponse.json({ error: 'Failed to create payment history' }, { status: 500 });
  }
}

/**
 * Get the effective payment method configuration for an employee on a specific date
 */
async function getEffectivePaymentMethod(employeeId: number, effectiveDate: string) {
  try {
    // Find the payment method record that was active on the given date
    const paymentHistory = await prisma.paymentMethodHistory.findFirst({
      where: {
        employeeId: employeeId,
        effectiveDate: { lte: effectiveDate },
        OR: [
          { endDate: null }, // Current active record
          { endDate: { gt: effectiveDate } } // Record that ended after the target date
        ]
      },
      orderBy: { effectiveDate: 'desc' }
    });

    if (paymentHistory) {
      return {
        employeeId: employeeId,
        paymentMethod: paymentHistory.paymentMethod as PaymentMethod,
        driverPercent: paymentHistory.driverPercent,
        companyPercent: paymentHistory.companyPercent,
        serviceFeePercent: paymentHistory.serviceFeePercent,
        payPerMileRate: paymentHistory.payPerMileRate,
        effectiveDate: paymentHistory.effectiveDate,
        endDate: paymentHistory.endDate,
        source: 'history'
      };
    }

    // Fallback to current employee settings if no history found
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        paymentMethod: true,
        driverPercent: true,
        companyPercent: true,
        serviceFeePercent: true,
        payPerMileRate: true
      }
    });

    if (employee) {
      return {
        employeeId: employeeId,
        paymentMethod: employee.paymentMethod as PaymentMethod,
        driverPercent: employee.driverPercent,
        companyPercent: employee.companyPercent,
        serviceFeePercent: employee.serviceFeePercent,
        payPerMileRate: employee.payPerMileRate,
        effectiveDate: effectiveDate,
        endDate: null,
        source: 'current'
      };
    }

    throw new Error('Employee not found');
  } catch (error) {
    console.error('Error getting effective payment method:', error);
    throw error;
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, note, endDate } = body;

    if (!id) {
      return NextResponse.json({ error: 'Payment history ID is required' }, { status: 400 });
    }

    const updated = await prisma.paymentMethodHistory.update({
      where: { id: id },
      data: {
        note: note,
        endDate: endDate
      }
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating payment history:', error);
    return NextResponse.json({ error: 'Failed to update payment history' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Payment history ID is required' }, { status: 400 });
    }

    await prisma.paymentMethodHistory.delete({
      where: { id: parseInt(id) }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting payment history:', error);
    return NextResponse.json({ error: 'Failed to delete payment history' }, { status: 500 });
  }
}

