import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Truck } from '@/lib/types'
import { todayISO } from '@/utils/dates'

export async function GET() {
  try {
    const list = await prisma.truck.findMany({
      include: { attachments: true },
      orderBy: { id: 'asc' }
    });
    return NextResponse.json(list);
  } catch (error) {
    console.error('Error fetching trucks:', error)
    return NextResponse.json({ error: 'Failed to fetch trucks' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as Partial<Truck>
  
  const item = await prisma.truck.create({
    data: {
      number: body.number || '',
      vin: body.vin || null,
      make: body.make || null,
      model: body.model || null,
      year: body.year ?? 0,
      type: body.type || null,
      status: (body.status as any) || 'ACTIVE',
      licensePlate: body.licensePlate || null,
      
      // Compliance and Expiry
      registrationExpiryDate: body.registrationExpiryDate || null,
      insuranceExpiryDate: body.insuranceExpiryDate || null,
      nextInspectionDue: body.nextInspectionDue || null,
      inspection: body.inspection || null,
      permitNumbers: body.permitNumbers || null,
      
      // Assignment
      driver: body.driver || null,
      assigned: !!body.assigned,
      
      // Audit
      createdDate: todayISO(),
      modifiedDate: todayISO(),
      modifiedBy: 'web',
      notes: body.notes || null,
    },
    include: { attachments: true }
  })
  
  return NextResponse.json(item, { status: 201 })
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as Truck
    
    // Validate required fields
    if (!body.id || !body.number || body.number.trim() === '') {
      return NextResponse.json({ error: 'Truck ID and number are required' }, { status: 400 })
    }

    // Check if truck exists
    const existingTruck = await prisma.truck.findUnique({ where: { id: body.id } })
    if (!existingTruck) {
      return NextResponse.json({ error: 'Truck not found' }, { status: 404 })
    }
    
    // Start a transaction to sync data across tables
    const result = await prisma.$transaction(async (tx) => {
      // Extract relation fields that shouldn't be updated directly
      const { attachments, ...updateData } = body
      
      const updated = await tx.truck.update({
        where: { id: body.id },
        data: {
          number: body.number.trim(),
          vin: body.vin || null,
          make: body.make || null,
          model: body.model || null,
          year: body.year ?? 0,
          type: body.type || null,
          status: body.status,
          licensePlate: body.licensePlate || null,
          
          // Compliance and Expiry
          registrationExpiryDate: body.registrationExpiryDate || null,
          insuranceExpiryDate: body.insuranceExpiryDate || null,
          nextInspectionDue: body.nextInspectionDue || null,
          inspection: body.inspection || null,
          permitNumbers: body.permitNumbers || null,
          
          // Assignment
          driver: body.driver ? body.driver.trim() : null,
          assigned: !!body.assigned,
          
          // Audit
          modifiedDate: todayISO(),
          modifiedBy: 'web-api',
          notes: body.notes || null,
        },
        include: { attachments: true }
      })

      // Clear old employee assignments for this truck
      await tx.employee.updateMany({
        where: { truckUnit: body.number.trim() },
        data: { truckUnit: null }
      })

      // Set new employee assignment
      if (body.driver && body.driver.trim()) {
        // Clear this driver's old truck assignment
        await tx.employee.updateMany({
          where: { name: body.driver.trim() },
          data: { truckUnit: null }
        })
        // Set the new assignment
        await tx.employee.updateMany({
          where: { name: body.driver.trim() },
          data: { truckUnit: body.number.trim() }
        })
      }

      return updated
    })
    
    return NextResponse.json(result)
  } catch (error) {
    console.error('Error updating truck:', error)
    return NextResponse.json({ error: 'Failed to update truck' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get('id'));
    
    if (!id) {
      return NextResponse.json({ error: 'Missing truck ID' }, { status: 400 })
    }

    // Check if truck exists
    const truck = await prisma.truck.findUnique({ where: { id } })
    if (!truck) {
      return NextResponse.json({ error: 'Truck not found' }, { status: 404 })
    }

    // Delete in transaction to maintain data integrity
    await prisma.$transaction(async (tx) => {
      // Clear employee assignments
      await tx.employee.updateMany({
        where: { truckUnit: truck.number },
        data: { truckUnit: null }
      })

      // Delete related records
      await tx.truckAttachment.deleteMany({ where: { truckId: id } })
      
      // Delete truck
      await tx.truck.delete({ where: { id } })
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Error deleting truck:', error)
    return NextResponse.json({ error: 'Failed to delete truck' }, { status: 500 })
  }
}
