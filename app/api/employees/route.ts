import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Employee } from '@/lib/types'
import { todayISO } from '@/utils/dates'

export async function GET() {
  try {
    const list = await prisma.employee.findMany({ 
      include: { attachments: true, percentageHistory: true, paymentHistory: true, audit: true }, 
      orderBy: { id: 'asc' } 
    });
    return NextResponse.json(list);
  } catch (error) {
    console.error('Error fetching employees:', error)
    return NextResponse.json({ error: 'Failed to fetch employees' }, { status: 500 })
  }
}
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<Employee>
    
    // Validate required fields
    if (!body.name || body.name.trim() === '') {
      return NextResponse.json({ error: 'Employee name is required' }, { status: 400 })
    }

    const item = await prisma.employee.create({ data: {
      name: body.name.trim(), 
      driverPercent: body.driverPercent ?? 0, 
      companyPercent: body.companyPercent ?? 0, 
      serviceFeePercent: body.serviceFeePercent ?? 0,
      
      // ENHANCED PAYMENT METHODS
      paymentMethod: body.paymentMethod || 'PERCENTAGE',
      payPerMileRate: body.payPerMileRate ?? 0,
      
      driverType: (body.driverType as any) || 'OWNER_OPERATOR', 
      status: (body.status as any) || 'ACTIVE', 
      createdDate: todayISO(), 
      modifiedDate: todayISO(), 
      modifiedBy: 'web-api',
      truckUnit: body.truckUnit || null, 
      trailerNumber: body.trailerNumber || null, 
      dob: body.dob || null, 
      licenseNumber: body.licenseNumber || null, 
      employeeLLC: body.employeeLLC || null,
      cdlExpiry: body.cdlExpiry || null, 
      medicalExpiry: body.medicalExpiry || null, 
      email: body.email || null, 
      phone: body.phone || null, 
      address: body.address || null, 
      city: body.city || null, 
      state: body.state || null, 
      zipCode: body.zipCode || null,
      hireDate: body.hireDate || null, 
      emergencyContact: body.emergencyContact || null, 
      emergencyPhone: body.emergencyPhone || null, 
      cdlClass: body.cdlClass || null, 
      hazmatEndorsement: !!body.hazmatEndorsement,
      totalMilesDriven: body.totalMilesDriven ?? 0, 
      safetyScore: body.safetyScore ?? 0, 
      totalLoadsCompleted: body.totalLoadsCompleted ?? 0, 
      fuelEfficiencyRating: body.fuelEfficiencyRating ?? 0,
      onTimeDeliveryRate: body.onTimeDeliveryRate ?? 0,
      accidentCount: body.accidentCount ?? 0,
      violationCount: body.violationCount ?? 0,
      customerRating: body.customerRating ?? 0,
      lastDrugTest: body.lastDrugTest || null, 
      lastPhysical: body.lastPhysical || null, 
      notes: body.notes || null, 
      totalEarningsYTD: body.totalEarningsYTD ?? 0, 
      totalDeductionsYTD: body.totalDeductionsYTD ?? 0, 
      advanceBalance: body.advanceBalance ?? 0, 
      escrowBalance: body.escrowBalance ?? 0, 
      weeklyPayRate: body.weeklyPayRate ?? 0,
    }, include: { attachments: true, percentageHistory: true, paymentHistory: true, audit: true } })
    
    return NextResponse.json(item, { status: 201 })
  } catch (error) {
    console.error('Error creating employee:', error)
    return NextResponse.json({ error: 'Failed to create employee' }, { status: 500 })
  }
}
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as Employee
    
    // Validate required fields
    if (!body.id || !body.name || body.name.trim() === '') {
      return NextResponse.json({ error: 'Employee ID and name are required' }, { status: 400 })
    }

    // Get the current employee record to compare assignments
    const currentEmployee = await prisma.employee.findUnique({ where: { id: body.id } })
    if (!currentEmployee) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
    }
    
    // Check if payment method or rates changed for historical tracking
    const paymentMethodChanged = 
      currentEmployee.paymentMethod !== body.paymentMethod ||
      currentEmployee.driverPercent !== body.driverPercent ||
      currentEmployee.companyPercent !== body.companyPercent ||
      currentEmployee.serviceFeePercent !== body.serviceFeePercent ||
      currentEmployee.payPerMileRate !== body.payPerMileRate;

    // Start a transaction to sync data across tables
    const result = await prisma.$transaction(async (tx) => {
      // Extract relation fields that shouldn't be updated directly
      const { attachments, percentageHistory, paymentHistory, audit, ...updateData } = body
      
      const updated = await tx.employee.update({
        where: { id: body.id },
        data: { 
          ...updateData, 
          name: body.name.trim(),
          modifiedDate: todayISO(),
          modifiedBy: 'web-api'
        },
        include: { attachments: true, percentageHistory: true, paymentHistory: true, audit: true }
      })

      // Create payment method history record if payment configuration changed
      if (paymentMethodChanged) {
        // End any current active payment method records
        await tx.paymentMethodHistory.updateMany({
          where: {
            employeeId: body.id,
            endDate: null
          },
          data: {
            endDate: todayISO()
          }
        });

        // Create new payment method history record
        await tx.paymentMethodHistory.create({
          data: {
            employeeId: body.id,
            paymentMethod: body.paymentMethod || 'PERCENTAGE',
            driverPercent: body.driverPercent || 0,
            companyPercent: body.companyPercent || 0,
            serviceFeePercent: body.serviceFeePercent || 0,
            payPerMileRate: body.payPerMileRate || 0,
            effectiveDate: todayISO(),
            endDate: null,
            note: 'Payment method updated via employee form',
            createdBy: 'web-api'
          }
        });
      }

      // Clear old assignments first (using both old and new names in case name changed)
      await tx.truck.updateMany({
        where: { 
          OR: [
            { driver: currentEmployee.name },
            { driver: body.name.trim() }
          ]
        },
        data: { driver: null, assigned: false }
      })
      await tx.trailer.updateMany({
        where: { 
          OR: [
            { assignedDriver: currentEmployee.name },
            { assignedDriver: body.name.trim() }
          ]
        },
        data: { assignedDriver: null, isAssigned: false }
      })

      // Set new assignments
      if (body.truckUnit && body.truckUnit.trim()) {
        await tx.truck.updateMany({
          where: { number: body.truckUnit.trim() },
          data: { driver: body.name.trim(), assigned: true }
        })
      }

      if (body.trailerNumber && body.trailerNumber.trim()) {
        await tx.trailer.updateMany({
          where: { trailerNumber: body.trailerNumber.trim() },
          data: { assignedDriver: body.name.trim(), isAssigned: true }
        })
      }

      return updated
    })
    
    return NextResponse.json(result)
  } catch (error) {
    console.error('Error updating employee:', error)
    return NextResponse.json({ error: 'Failed to update employee' }, { status: 500 })
  }
}
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url); 
    const id = Number(searchParams.get('id')); 
    
    if (!id) {
      return NextResponse.json({ error: 'Missing employee ID' }, { status: 400 })
    }

    // Check if employee exists
    const employee = await prisma.employee.findUnique({ where: { id } })
    if (!employee) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
    }

    // Delete in transaction to maintain data integrity
    await prisma.$transaction(async (tx) => {
      // Clear any truck/trailer assignments
      await tx.truck.updateMany({
        where: { driver: employee.name },
        data: { driver: null, assigned: false }
      })
      await tx.trailer.updateMany({
        where: { assignedDriver: employee.name },
        data: { assignedDriver: null, isAssigned: false }
      })

      // Delete related records
      await tx.attachment.deleteMany({ where: { employeeId: id } })
      await tx.percentageSnapshot.deleteMany({ where: { employeeId: id } })
      await tx.paymentMethodHistory.deleteMany({ where: { employeeId: id } })
      await tx.auditEntry.deleteMany({ where: { employeeId: id } })
      
      // Delete employee
      await tx.employee.delete({ where: { id } })
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Error deleting employee:', error)
    return NextResponse.json({ error: 'Failed to delete employee' }, { status: 500 })
  }
}
