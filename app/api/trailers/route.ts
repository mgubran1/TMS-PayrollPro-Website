import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Trailer } from '@/lib/types'
import { todayISO } from '@/utils/dates'

export async function GET() {
  const list = await prisma.trailer.findMany({
    include: { attachments: true },
    orderBy: { id: 'asc' }
  });
  return NextResponse.json(list);
}

export async function POST(req: NextRequest) {
  const body = await req.json() as Partial<Trailer>
  
  const item = await prisma.trailer.create({
    data: {
      trailerNumber: body.trailerNumber || '',
      vin: body.vin || null,
      make: body.make || null,
      model: body.model || null,
      year: body.year ?? 0,
      type: body.type || null,
      status: (body.status as any) || 'ACTIVE',
      licensePlate: body.licensePlate || null,
      registrationExpiryDate: body.registrationExpiryDate || null,
      currentLocation: body.currentLocation || null,
      
      // Technical Specifications
      length: body.length ?? 0,
      width: body.width ?? 0,
      height: body.height ?? 0,
      capacity: body.capacity ?? 0,
      maxWeight: body.maxWeight ?? 0,
      emptyWeight: body.emptyWeight ?? 0,
      axleCount: body.axleCount ?? 2,
      suspensionType: body.suspensionType || null,
      hasThermalUnit: !!body.hasThermalUnit,
      thermalUnitDetails: body.thermalUnitDetails || null,
      
      // Financial and Ownership
      ownershipType: (body.ownershipType as any) || 'Company',
      purchasePrice: body.purchasePrice ?? 0,
      purchaseDate: body.purchaseDate || null,
      currentValue: body.currentValue ?? 0,
      monthlyLeaseCost: body.monthlyLeaseCost ?? 0,
      leaseDetails: body.leaseDetails || null,
      leaseAgreementExpiryDate: body.leaseAgreementExpiryDate || null,
      insurancePolicyNumber: body.insurancePolicyNumber || null,
      insuranceExpiryDate: body.insuranceExpiryDate || null,
      
      // Maintenance
      odometerReading: body.odometerReading ?? 0,
      lastInspectionDate: body.lastInspectionDate || null,
      nextInspectionDueDate: body.nextInspectionDueDate || null,
      lastServiceDate: body.lastServiceDate || null,
      nextServiceDueDate: body.nextServiceDueDate || null,
      currentCondition: (body.currentCondition as any) || 'Good',
      maintenanceNotes: body.maintenanceNotes || null,
      
      // Usage and Assignment
      assignedDriver: body.assignedDriver || null,
      assignedTruck: body.assignedTruck || null,
      isAssigned: !!body.isAssigned,
      currentJobId: body.currentJobId || null,
      
      // Tracking
      lastUpdated: todayISO(),
      updatedBy: 'web',
      notes: body.notes || null,
    },
    include: { attachments: true }
  })
  
  return NextResponse.json(item, { status: 201 })
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as Trailer
    
    // Validate required fields
    if (!body.id || !body.trailerNumber || body.trailerNumber.trim() === '') {
      return NextResponse.json({ error: 'Trailer ID and number are required' }, { status: 400 })
    }

    // Check if trailer exists
    const existingTrailer = await prisma.trailer.findUnique({ where: { id: body.id } })
    if (!existingTrailer) {
      return NextResponse.json({ error: 'Trailer not found' }, { status: 404 })
    }
    
    // Start a transaction to sync data across tables
    const result = await prisma.$transaction(async (tx) => {
      // Extract relation fields that shouldn't be updated directly
      const { attachments, ...updateData } = body
      
      const updated = await tx.trailer.update({
        where: { id: body.id },
        data: {
        trailerNumber: body.trailerNumber.trim(),
        vin: body.vin || null,
        make: body.make || null,
        model: body.model || null,
        year: body.year ?? 0,
        type: body.type || null,
        status: body.status,
        licensePlate: body.licensePlate || null,
        registrationExpiryDate: body.registrationExpiryDate || null,
        currentLocation: body.currentLocation || null,
        
        // Technical Specifications
        length: body.length ?? 0,
        width: body.width ?? 0,
        height: body.height ?? 0,
        capacity: body.capacity ?? 0,
        maxWeight: body.maxWeight ?? 0,
        emptyWeight: body.emptyWeight ?? 0,
        axleCount: body.axleCount ?? 2,
        suspensionType: body.suspensionType || null,
        hasThermalUnit: !!body.hasThermalUnit,
        thermalUnitDetails: body.thermalUnitDetails || null,
        
        // Financial and Ownership
        ownershipType: body.ownershipType,
        purchasePrice: body.purchasePrice ?? 0,
        purchaseDate: body.purchaseDate || null,
        currentValue: body.currentValue ?? 0,
        monthlyLeaseCost: body.monthlyLeaseCost ?? 0,
        leaseDetails: body.leaseDetails || null,
        leaseAgreementExpiryDate: body.leaseAgreementExpiryDate || null,
        insurancePolicyNumber: body.insurancePolicyNumber || null,
        insuranceExpiryDate: body.insuranceExpiryDate || null,
        
        // Maintenance
        odometerReading: body.odometerReading ?? 0,
        lastInspectionDate: body.lastInspectionDate || null,
        nextInspectionDueDate: body.nextInspectionDueDate || null,
        lastServiceDate: body.lastServiceDate || null,
        nextServiceDueDate: body.nextServiceDueDate || null,
        currentCondition: body.currentCondition,
        maintenanceNotes: body.maintenanceNotes || null,
        
        // Usage and Assignment
        assignedDriver: body.assignedDriver || null,
        assignedTruck: body.assignedTruck || null,
        isAssigned: !!body.isAssigned,
        currentJobId: body.currentJobId || null,
        
        // Tracking
        lastUpdated: todayISO(),
        updatedBy: 'web',
        notes: body.notes || null,
      },
      include: { attachments: true }
    })

    // Clear old employee assignments for this trailer
    await tx.employee.updateMany({
      where: { trailerNumber: body.trailerNumber },
      data: { trailerNumber: null }
    })

    // Set new employee assignment
    if (body.assignedDriver) {
      // Clear this driver's old trailer assignment
      await tx.employee.updateMany({
        where: { name: body.assignedDriver },
        data: { trailerNumber: null }
      })
      // Set the new assignment
      await tx.employee.updateMany({
        where: { name: body.assignedDriver },
        data: { trailerNumber: body.trailerNumber }
      })
    }

      return updated
    })
    
    return NextResponse.json(result)
  } catch (error) {
    console.error('Error updating trailer:', error)
    return NextResponse.json({ error: 'Failed to update trailer' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = Number(searchParams.get('id'));
  
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  }
  
  // Delete related attachments first
  await prisma.trailerAttachment.deleteMany({ where: { trailerId: id } });
  
  // Delete the trailer
  await prisma.trailer.delete({ where: { id } })
  
  return NextResponse.json({ ok: true })
}
