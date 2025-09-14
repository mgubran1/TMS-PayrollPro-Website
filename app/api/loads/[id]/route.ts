import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { LoadUpdateRequest } from '@/lib/loads-types'
import { todayISO } from '@/utils/dates'

// GET /api/loads/[id] - Get single load by ID
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id)
    
    if (isNaN(id)) {
      return NextResponse.json(
        { error: 'Invalid load ID' },
        { status: 400 }
      )
    }
    
    const load = await prisma.load.findUnique({
      where: { id },
      include: {
        locations: {
          orderBy: [
            { type: 'asc' },
            { sequence: 'asc' }
          ]
        },
        documents: {
          orderBy: { uploadDate: 'desc' }
        }
      }
    })
    
    if (!load) {
      return NextResponse.json(
        { error: 'Load not found' },
        { status: 404 }
      )
    }

    // Manually fetch employee and trailer data
    let employee = null
    let trailer = null

    if (load.driverId && load.driverId > 0) {
      employee = await prisma.employee.findUnique({
        where: { id: load.driverId },
        select: {
          id: true,
          name: true,
          truckUnit: true,
          status: true
        }
      })
    }

    if (load.trailerId && load.trailerId > 0) {
      trailer = await prisma.trailer.findUnique({
        where: { id: load.trailerId },
        select: {
          id: true,
          trailerNumber: true,
          status: true
        }
      })
    }

    const loadWithRelations = {
      ...load,
      employee,
      trailer
    }
    
    console.log(`Retrieved load: ${load.loadNumber}`)
    return NextResponse.json(loadWithRelations)
    
  } catch (error) {
    console.error('Error fetching load:', error)
    return NextResponse.json(
      { error: 'Failed to fetch load' },
      { status: 500 }
    )
  }
}

// PUT /api/loads/[id] - Update existing load
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id)
    
    if (isNaN(id)) {
      return NextResponse.json(
        { error: 'Invalid load ID' },
        { status: 400 }
      )
    }
    
    const data: LoadUpdateRequest = await req.json()
    
    // Check if load exists
    const existingLoad = await prisma.load.findUnique({
      where: { id }
    })
    
    if (!existingLoad) {
      return NextResponse.json(
        { error: 'Load not found' },
        { status: 404 }
      )
    }
    
    // Check for duplicate load number if being changed
    if (data.loadNumber && data.loadNumber !== existingLoad.loadNumber) {
      const duplicateLoad = await prisma.load.findUnique({
        where: { loadNumber: data.loadNumber }
      })
      
      if (duplicateLoad) {
        return NextResponse.json(
          { error: 'Load number already exists' },
          { status: 409 }
        )
      }
    }
    
    // Get updated driver information if driverId changed
    let driverName = existingLoad.driverName
    let truckUnitSnapshot = existingLoad.truckUnitSnapshot
    
    if (data.driverId !== undefined && data.driverId !== existingLoad.driverId) {
      if (data.driverId === 0) {
        // Unassigning driver
        driverName = null
        truckUnitSnapshot = null
      } else {
        const employee = await prisma.employee.findUnique({
          where: { id: data.driverId },
          select: { name: true, truckUnit: true, status: true }
        })
        
        if (employee) {
          driverName = employee.name
          truckUnitSnapshot = employee.truckUnit
          
          // Warn if driver is inactive
          if (employee.status !== 'ACTIVE') {
            console.warn(`Assigning load to inactive driver: ${employee.name}`)
          }
        } else {
          return NextResponse.json(
            { error: 'Driver not found' },
            { status: 400 }
          )
        }
      }
    }
    
    // Get updated trailer information if trailerId changed
    let trailerNumber = existingLoad.trailerNumber
    
    if (data.trailerId !== undefined && data.trailerId !== existingLoad.trailerId) {
      if (data.trailerId === 0) {
        // Unassigning trailer
        trailerNumber = null
      } else {
        const trailer = await prisma.trailer.findUnique({
          where: { id: data.trailerId },
          select: { trailerNumber: true, status: true }
        })
        
        if (trailer) {
          trailerNumber = trailer.trailerNumber
          
          // Warn if trailer is not available
          if (trailer.status !== 'ACTIVE' && trailer.status !== 'AVAILABLE') {
            console.warn(`Assigning load to non-available trailer: ${trailer.trailerNumber}`)
          }
        } else {
          return NextResponse.json(
            { error: 'Trailer not found' },
            { status: 400 }
          )
        }
      }
    }
    
    // Calculate driver rate if gross amount changed and no explicit driver rate provided
    let driverRate = existingLoad.driverRate
    if (data.grossAmount !== undefined && data.driverRate === undefined) {
      driverRate = data.grossAmount * 0.75
    } else if (data.driverRate !== undefined) {
      driverRate = data.driverRate
    }
    
    // Parse location fields from combined location strings
    const parseLocation = (location?: string) => {
      if (location === undefined) return {}
      if (!location) return { city: null, state: null }
      const parts = location.split(',').map(p => p.trim())
      return {
        city: parts[0] || null,
        state: parts[1] || null
      }
    }
    
    const pickup = parseLocation(data.pickUpLocation)
    const delivery = parseLocation(data.dropLocation)
    
    // Build update data
    const updateData: any = {
      modifiedDate: todayISO(),
      modifiedBy: 'web'
    }
    
    // Only update fields that are provided
    if (data.loadNumber !== undefined) updateData.loadNumber = data.loadNumber.trim()
    if (data.poNumber !== undefined) updateData.poNumber = data.poNumber?.trim() || null
    if (data.customer !== undefined) updateData.customer = data.customer.trim()
    if (data.customer2 !== undefined) updateData.customer2 = data.customer2?.trim() || null
    if (data.billTo !== undefined) updateData.billTo = data.billTo?.trim() || null
    
    if (data.pickUpLocation !== undefined) {
      updateData.pickUpLocation = data.pickUpLocation?.trim() || null
      updateData.pickupCity = pickup.city
      updateData.pickupState = pickup.state
    }
    if (data.dropLocation !== undefined) {
      updateData.dropLocation = data.dropLocation?.trim() || null
      updateData.deliveryCity = delivery.city
      updateData.deliveryState = delivery.state
    }
    
    if (data.pickUpDate !== undefined) updateData.pickUpDate = data.pickUpDate
    if (data.pickUpTime !== undefined) updateData.pickUpTime = data.pickUpTime
    if (data.deliveryDate !== undefined) updateData.deliveryDate = data.deliveryDate
    if (data.deliveryTime !== undefined) updateData.deliveryTime = data.deliveryTime
    
    if (data.driverId !== undefined) {
      updateData.driverId = data.driverId
      updateData.driverName = driverName
      updateData.truckUnitSnapshot = truckUnitSnapshot
    }
    if (data.trailerId !== undefined) {
      updateData.trailerId = data.trailerId
      updateData.trailerNumber = trailerNumber
    }
    
    if (data.status !== undefined) updateData.status = data.status
    if (data.grossAmount !== undefined) updateData.grossAmount = data.grossAmount
    updateData.driverRate = driverRate
    
    if (data.notes !== undefined) updateData.notes = data.notes?.trim() || null
    if (data.reminder !== undefined) updateData.reminder = data.reminder?.trim() || null
    
    if (data.hasLumper !== undefined) updateData.hasLumper = data.hasLumper
    if (data.lumperAmount !== undefined) updateData.lumperAmount = data.lumperAmount
    if (data.hasRevisedRateConfirmation !== undefined) updateData.hasRevisedRateConfirmation = data.hasRevisedRateConfirmation
    
    // ENHANCED PAYMENT CALCULATION FIELDS
    if (data.paymentMethod !== undefined) updateData.paymentMethod = data.paymentMethod
    if (data.calculatedMiles !== undefined) updateData.calculatedMiles = data.calculatedMiles
    if (data.adjustedMiles !== undefined) updateData.adjustedMiles = data.adjustedMiles
    if (data.finalMiles !== undefined) updateData.finalMiles = data.finalMiles
    if (data.payPerMileRate !== undefined) updateData.payPerMileRate = data.payPerMileRate
    if (data.paymentCalculatedAt !== undefined) updateData.paymentCalculatedAt = data.paymentCalculatedAt
    if (data.paymentCalculatedBy !== undefined) updateData.paymentCalculatedBy = data.paymentCalculatedBy
    
    // Update the load without include relations to avoid foreign key issues
    const updatedLoad = await prisma.load.update({
      where: { id },
      data: updateData,
      include: {
        locations: {
          orderBy: [
            { type: 'asc' },
            { sequence: 'asc' }
          ]
        },
        documents: true
      }
    })

    // AUTO-CALCULATE PAYMENT when status changes to DELIVERED
    if (data.status === 'DELIVERED' && existingLoad.status !== 'DELIVERED' && updatedLoad.driverId > 0 && updatedLoad.grossAmount > 0) {
      try {
        console.log(`Auto-calculating payment for delivered load ${updatedLoad.loadNumber}`)
        
        const calculationResponse = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/loads/payment-calculation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            loadId: updatedLoad.id,
            driverId: updatedLoad.driverId
          })
        });

        if (calculationResponse.ok) {
          const paymentResult = await calculationResponse.json();
          
          // Update load with calculated payment information
          const paymentUpdate = await prisma.load.update({
            where: { id: updatedLoad.id },
            data: {
              driverRate: paymentResult.driverRate,
              paymentMethod: paymentResult.paymentMethod,
              calculatedMiles: paymentResult.calculatedMiles || 0,
              adjustedMiles: paymentResult.adjustedMiles || 0,
              finalMiles: paymentResult.finalMiles || 0,
              payPerMileRate: paymentResult.payPerMileRate || 0,
              paymentCalculatedAt: new Date().toISOString(),
              paymentCalculatedBy: 'auto-delivery'
            }
          });

          // Update the updatedLoad object with payment data
          Object.assign(updatedLoad, {
            driverRate: paymentResult.driverRate,
            paymentMethod: paymentResult.paymentMethod,
            calculatedMiles: paymentResult.calculatedMiles || 0,
            adjustedMiles: paymentResult.adjustedMiles || 0,
            finalMiles: paymentResult.finalMiles || 0,
            payPerMileRate: paymentResult.payPerMileRate || 0,
            paymentCalculatedAt: new Date().toISOString(),
            paymentCalculatedBy: 'auto-delivery'
          });

          console.log(`Payment auto-calculated on delivery for load ${updatedLoad.loadNumber}: Driver Rate $${paymentResult.driverRate}`);
        } else {
          console.error('Failed to auto-calculate payment on delivery:', await calculationResponse.text());
        }
      } catch (error) {
        console.error('Error auto-calculating payment on delivery:', error);
        // Don't fail the update if payment calculation fails
      }
    }

    // Manually fetch employee and trailer data
    let employee = null
    let trailer = null

    if (updatedLoad.driverId && updatedLoad.driverId > 0) {
      employee = await prisma.employee.findUnique({
        where: { id: updatedLoad.driverId },
        select: {
          id: true,
          name: true,
          truckUnit: true,
          paymentMethod: true,
          driverPercent: true,
          companyPercent: true,
          serviceFeePercent: true,
          payPerMileRate: true,
          status: true
        }
      })
    }

    if (updatedLoad.trailerId && updatedLoad.trailerId > 0) {
      trailer = await prisma.trailer.findUnique({
        where: { id: updatedLoad.trailerId },
        select: {
          id: true,
          trailerNumber: true,
          status: true
        }
      })
    }

    // Combine data for response
    const loadWithRelations = {
      ...updatedLoad,
      employee,
      trailer
    }
    
    // Update locations if provided
    if (data.locations) {
      // Remove existing additional locations (keep primary pickup/drop)
      await prisma.loadLocation.deleteMany({
        where: { 
          loadId: id,
          sequence: { gt: 1 }
        }
      })
      
      // Create new additional locations
      for (const location of data.locations.filter(l => l.sequence > 1)) {
        await prisma.loadLocation.create({
          data: {
            loadId: id,
            type: location.type,
            sequence: location.sequence,
            customer: location.customer?.trim() || null,
            address: location.address?.trim() || null,
            city: location.city?.trim() || null,
            state: location.state?.trim() || null,
            date: location.date || null,
            time: location.time || null,
            notes: location.notes?.trim() || null
          }
        })
      }
    }
    
    console.log(`Updated load: ${updatedLoad.loadNumber}`)
    return NextResponse.json(loadWithRelations)
    
  } catch (error) {
    console.error('Error updating load:', error)
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json(
        { error: 'Load number already exists' },
        { status: 409 }
      )
    }
    return NextResponse.json(
      { error: 'Failed to update load' },
      { status: 500 }
    )
  }
}

// DELETE /api/loads/[id] - Delete load
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id)
    
    if (isNaN(id)) {
      return NextResponse.json(
        { error: 'Invalid load ID' },
        { status: 400 }
      )
    }
    
    // Parse request body for admin override options
    let requestBody: any = {}
    try {
      const bodyText = await req.text()
      if (bodyText) {
        requestBody = JSON.parse(bodyText)
      }
    } catch (e) {
      // No body or invalid JSON, continue with empty body
    }
    
    const { forceDelete = false, reason = 'No reason provided' } = requestBody
    
    // Check if load exists
    const existingLoad = await prisma.load.findUnique({
      where: { id },
      select: { 
        id: true,
        loadNumber: true, 
        status: true,
        driverId: true,
        driverName: true,
        grossAmount: true,
        driverRate: true,
        deliveryDate: true
      }
    })
    
    if (!existingLoad) {
      return NextResponse.json(
        { error: 'Load not found' },
        { status: 404 }
      )
    }
    
    // Check if this is a delivered or paid load
    const isDeliveredOrPaid = existingLoad.status === 'DELIVERED' || existingLoad.status === 'PAID'
    
    if (isDeliveredOrPaid && !forceDelete) {
      return NextResponse.json(
        { 
          error: `Cannot delete ${existingLoad.status.toLowerCase()} loads without admin override`,
          details: 'Delivered or paid loads affect payroll calculations and audit trails. Use forceDelete flag if absolutely necessary.',
          loadInfo: {
            loadNumber: existingLoad.loadNumber,
            status: existingLoad.status,
            driverName: existingLoad.driverName,
            grossAmount: existingLoad.grossAmount,
            deliveryDate: existingLoad.deliveryDate
          }
        },
        { status: 400 }
      )
    }
    
    // Log admin override for audit purposes
    if (isDeliveredOrPaid && forceDelete) {
      console.warn(`🚨 ADMIN OVERRIDE: Force deleting ${existingLoad.status} load ${existingLoad.loadNumber}`)
      console.warn(`Reason: ${reason}`)
      console.warn(`Load details:`, {
        id: existingLoad.id,
        loadNumber: existingLoad.loadNumber,
        status: existingLoad.status,
        driverId: existingLoad.driverId,
        driverName: existingLoad.driverName,
        grossAmount: existingLoad.grossAmount,
        driverRate: existingLoad.driverRate,
        deliveryDate: existingLoad.deliveryDate,
        deletedAt: new Date().toISOString()
      })
      
      // TODO: Consider logging this to an audit table for compliance
      // await prisma.auditLog.create({ ... })
    }
    
    // Delete the load (cascade will handle related records)
    await prisma.load.delete({
      where: { id }
    })
    
    const logMessage = isDeliveredOrPaid 
      ? `🚨 FORCE DELETED ${existingLoad.status} load: ${existingLoad.loadNumber} (Reason: ${reason})`
      : `✅ Deleted load: ${existingLoad.loadNumber}`
      
    console.log(logMessage)
    
    // Update payroll if this was a delivered load
    if (existingLoad.status === 'DELIVERED' && existingLoad.driverId > 0) {
      try {
        console.log(`🔄 Updating payroll for deleted load ${existingLoad.loadNumber}`)
        
        const payrollUpdateResponse = await fetch(new URL('/api/payroll/load-updates', req.url).toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'LOAD_DELETED',
            loadData: {
              id: existingLoad.id,
              loadNumber: existingLoad.loadNumber,
              driverId: existingLoad.driverId,
              driverName: existingLoad.driverName,
              status: existingLoad.status,
              grossAmount: existingLoad.grossAmount,
              driverRate: existingLoad.driverRate,
              deliveryDate: existingLoad.deliveryDate
            },
            reason: isDeliveredOrPaid ? `Admin force delete: ${reason}` : 'Load deleted'
          })
        })
        
        if (payrollUpdateResponse.ok) {
          const updateResult = await payrollUpdateResponse.json()
          console.log(`✅ Payroll updated: ${updateResult.affectedPaystubs} paystubs affected`)
        } else {
          console.warn('⚠️ Failed to update payroll for deleted load:', await payrollUpdateResponse.text())
        }
        
      } catch (payrollError) {
        console.error('❌ Error updating payroll for deleted load:', payrollError)
        // Don't fail the deletion if payroll update fails
      }
    }
    
    return NextResponse.json({ 
      message: isDeliveredOrPaid ? 'Load force deleted successfully' : 'Load deleted successfully',
      loadNumber: existingLoad.loadNumber,
      wasForceDelete: isDeliveredOrPaid && forceDelete,
      reason: isDeliveredOrPaid ? reason : undefined
    })
    
  } catch (error) {
    console.error('Error deleting load:', error)
    return NextResponse.json(
      { error: 'Failed to delete load' },
      { status: 500 }
    )
  }
}
