import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { calculateMileageWithFallbacks, extractZipFromAddress } from '@/lib/mileage-service';
import type { Load } from '@/lib/loads-types';
import type { Employee, PaymentMethod } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { loadId, driverId, paymentMethod, overrideRate, calculationDate, loadData } = body;

    // For new loads, use loadData instead of fetching from database
    let load = null;
    
    if (loadId) {
      // Get existing load details
      load = await prisma.load.findUnique({
        where: { id: loadId },
        include: { locations: true }
      });

      if (!load) {
        return NextResponse.json({ error: 'Load not found' }, { status: 404 });
      }
    } else if (loadData) {
      // Use provided load data for new loads (before saving to DB)
      load = {
        id: 0, // Temporary ID for new loads
        ...loadData,
        locations: loadData.locations || []
      };
    } else {
      return NextResponse.json({ error: 'Load ID or load data is required' }, { status: 400 });
    }

    // Get employee details for payment calculation
    let employee: Employee | null = null;
    let effectivePaymentConfig: any = null;
    
    if (driverId) {
      employee = await prisma.employee.findUnique({
        where: { id: driverId },
        include: { paymentHistory: true }
      });

      // Get effective payment configuration for the calculation date
      // Use load creation date, delivery date, or today as calculation date
      const effectiveDate = calculationDate || load.deliveryDate || load.createdDate || new Date().toISOString().split('T')[0];
      
      try {
        const response = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/employees/payment-history?employeeId=${driverId}&effectiveDate=${effectiveDate}`);
        if (response.ok) {
          effectivePaymentConfig = await response.json();
        }
      } catch (error) {
        console.warn('Failed to get historical payment config, using current:', error);
      }
    }

    // Determine effective payment method and rates
    const effectivePaymentMethod: PaymentMethod = paymentMethod || effectivePaymentConfig?.paymentMethod || employee?.paymentMethod || 'PERCENTAGE';
    const effectiveEmployee = effectivePaymentConfig ? {
      ...employee,
      paymentMethod: effectivePaymentConfig.paymentMethod,
      driverPercent: effectivePaymentConfig.driverPercent,
      companyPercent: effectivePaymentConfig.companyPercent,
      serviceFeePercent: effectivePaymentConfig.serviceFeePercent,
      payPerMileRate: effectivePaymentConfig.payPerMileRate
    } : employee;

    // Calculate payment based on method
    const result = await calculatePaymentForLoad(load as any, effectiveEmployee, effectivePaymentMethod, overrideRate);

    return NextResponse.json(result);

  } catch (error) {
    console.error('Payment calculation error:', error);
    return NextResponse.json(
      { error: 'Failed to calculate payment' },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { loadId, driverRate, calculatedMiles, adjustedMiles, paymentMethod, payPerMileRate, updatedBy } = body;

    if (!loadId) {
      return NextResponse.json({ error: 'Load ID is required' }, { status: 400 });
    }

    // Update load with payment calculation results
    const updatedLoad = await prisma.load.update({
      where: { id: loadId },
      data: {
        driverRate: driverRate,
        calculatedMiles: calculatedMiles || 0,
        adjustedMiles: adjustedMiles || 0,
        finalMiles: adjustedMiles || calculatedMiles || 0,
        paymentMethod: paymentMethod,
        payPerMileRate: payPerMileRate || 0,
        paymentCalculatedAt: new Date().toISOString(),
        paymentCalculatedBy: updatedBy || 'system',
        modifiedDate: new Date().toISOString(),
        modifiedBy: updatedBy || 'system'
      }
    });

    return NextResponse.json(updatedLoad);

  } catch (error) {
    console.error('Payment update error:', error);
    return NextResponse.json(
      { error: 'Failed to update payment calculation' },
      { status: 500 }
    );
  }
}

async function calculatePaymentForLoad(
  load: Load,
  employee: Employee | null,
  paymentMethod: PaymentMethod,
  overrideRate?: number
): Promise<any> {
  
  const result = {
    loadId: load.id,
    loadNumber: load.loadNumber,
    grossAmount: load.grossAmount,
    paymentMethod: paymentMethod,
    calculatedMiles: 0,
    adjustedMiles: 0,
    finalMiles: 0,
    payPerMileRate: 0,
    driverRate: 0,
    serviceFee: 0,
    netToDriver: 0,
    calculation: {} as any,
    mileageResult: null as any,
    error: null as string | null
  };

  try {
    switch (paymentMethod) {
      case 'PERCENTAGE':
        return await calculatePercentagePayment(load, employee, result);
      
      case 'PAY_PER_MILE':
        return await calculateMileagePayment(load, employee, result, overrideRate);
      
      case 'FLAT_RATE':
        return calculateFlatRatePayment(load, employee, result, overrideRate);
      
      default:
        throw new Error(`Unknown payment method: ${paymentMethod}`);
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Calculation failed';
    return result;
  }
}

async function calculatePercentagePayment(load: Load, employee: Employee | null, result: any) {
  if (!employee) {
    throw new Error('Employee required for percentage payment calculation');
  }

  // Get effective percentages (could be from payment history in the future)
  const driverPercent = employee.driverPercent;
  const companyPercent = employee.companyPercent;
  const serviceFeePercent = employee.serviceFeePercent;

  // Calculate service fee
  const serviceFee = load.grossAmount * (serviceFeePercent / 100);
  const grossAfterServiceFee = load.grossAmount - serviceFee;

  // Calculate driver share
  const driverRate = grossAfterServiceFee * (driverPercent / 100);

  result.driverRate = Math.round(driverRate * 100) / 100;
  result.serviceFee = Math.round(serviceFee * 100) / 100;
  result.netToDriver = result.driverRate;
  result.payPerMileRate = 0;
  
  result.calculation = {
    method: 'PERCENTAGE',
    grossAmount: load.grossAmount,
    serviceFeePercent: serviceFeePercent,
    serviceFee: result.serviceFee,
    grossAfterServiceFee: grossAfterServiceFee,
    driverPercent: driverPercent,
    companyPercent: companyPercent,
    driverShare: result.driverRate,
    companyShare: grossAfterServiceFee * (companyPercent / 100)
  };

  return result;
}

async function calculateMileagePayment(load: Load, employee: Employee | null, result: any, overrideRate?: number) {
  if (!employee && !overrideRate) {
    throw new Error('Employee or override rate required for mileage payment calculation');
  }

  // Extract zip codes from pickup and delivery locations
  const pickupZip = extractPickupZip(load);
  const deliveryZip = extractDeliveryZip(load);

  if (!pickupZip || !deliveryZip) {
    throw new Error('Could not extract zip codes from load locations');
  }

  // Calculate mileage
  const mileageResult = await calculateMileageWithFallbacks(pickupZip, deliveryZip);
  result.mileageResult = mileageResult;
  result.calculatedMiles = mileageResult.miles;
  result.finalMiles = load.adjustedMiles || mileageResult.miles;

  // Use override rate or employee's rate
  const ratePerMile = overrideRate || employee?.payPerMileRate || 0;
  result.payPerMileRate = ratePerMile;

  // Calculate payment
  const driverRate = result.finalMiles * ratePerMile;
  
  // Calculate service fee if employee exists
  const serviceFeePercent = employee?.serviceFeePercent || 0;
  const serviceFee = load.grossAmount * (serviceFeePercent / 100);

  result.driverRate = Math.round(driverRate * 100) / 100;
  result.serviceFee = Math.round(serviceFee * 100) / 100;
  result.netToDriver = result.driverRate;

  result.calculation = {
    method: 'PAY_PER_MILE',
    grossAmount: load.grossAmount,
    pickupZip: pickupZip,
    deliveryZip: deliveryZip,
    calculatedMiles: mileageResult.miles,
    finalMiles: result.finalMiles,
    ratePerMile: ratePerMile,
    mileagePayment: result.driverRate,
    serviceFeePercent: serviceFeePercent,
    serviceFee: result.serviceFee,
    mileageCalculationMethod: mileageResult.method
  };

  return result;
}

function calculateFlatRatePayment(load: Load, employee: Employee | null, result: any, overrideRate?: number) {
  // For flat rate, the rate must be provided as override since it's set per load
  if (!overrideRate) {
    throw new Error('Flat rate amount must be specified for this load');
  }

  const driverRate = overrideRate;
  
  // Calculate service fee if employee exists
  const serviceFeePercent = employee?.serviceFeePercent || 0;
  const serviceFee = load.grossAmount * (serviceFeePercent / 100);

  result.driverRate = Math.round(driverRate * 100) / 100;
  result.serviceFee = Math.round(serviceFee * 100) / 100;
  result.netToDriver = result.driverRate;
  result.payPerMileRate = 0;

  result.calculation = {
    method: 'FLAT_RATE',
    grossAmount: load.grossAmount,
    flatRateAmount: driverRate,
    serviceFeePercent: serviceFeePercent,
    serviceFee: result.serviceFee
  };

  return result;
}

function extractPickupZip(load: Load): string | null {
  // Try to extract from pickup location string
  if (load.pickUpLocation) {
    const zip = extractZipFromAddress(load.pickUpLocation);
    if (zip) return zip;
  }

  // Try to extract from parsed location fields
  if (load.pickupCity && load.pickupState) {
    // This would require a city/state to zip lookup service
    // For now, return null and let the caller handle it
  }

  // Try to extract from load locations (if any)
  if (load.locations && load.locations.length > 0) {
    const pickupLocation = load.locations.find(loc => loc.type === 'PICKUP');
    if (pickupLocation?.address) {
      return extractZipFromAddress(pickupLocation.address);
    }
  }

  return null;
}

function extractDeliveryZip(load: Load): string | null {
  // Try to extract from delivery location string
  if (load.dropLocation) {
    const zip = extractZipFromAddress(load.dropLocation);
    if (zip) return zip;
  }

  // Try to extract from parsed location fields
  if (load.deliveryCity && load.deliveryState) {
    // This would require a city/state to zip lookup service
    // For now, return null and let the caller handle it
  }

  // Try to extract from load locations (if any)
  if (load.locations && load.locations.length > 0) {
    const deliveryLocation = load.locations.find(loc => loc.type === 'DROP');
    if (deliveryLocation?.address) {
      return extractZipFromAddress(deliveryLocation.address);
    }
  }

  return null;
}
