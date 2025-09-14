import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/address-book/[id] - Get single address book entry
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id)
    
    if (isNaN(id)) {
      return NextResponse.json(
        { error: 'Invalid address book entry ID' },
        { status: 400 }
      )
    }
    
    const entry = await prisma.customerAddressBook.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            name: true,
            phone: true,
            email: true,
            isActive: true
          }
        }
      }
    })
    
    if (!entry) {
      return NextResponse.json(
        { error: 'Address book entry not found' },
        { status: 404 }
      )
    }
    
    // Add usage statistics
    const usageCount = await prisma.load.count({
      where: {
        OR: [
          { 
            AND: [
              { customer: entry.customerName },
              { pickUpLocation: { contains: entry.city || '' } }
            ]
          },
          { 
            AND: [
              { customer2: entry.customerName },
              { dropLocation: { contains: entry.city || '' } }
            ]
          }
        ]
      }
    })
    
    const entryWithUsage = {
      ...entry,
      usageCount,
      fullAddress: [entry.address, entry.city, entry.state]
        .filter(Boolean)
        .join(', '),
      displayText: entry.locationName 
        ? `${entry.locationName} - ${[entry.address, entry.city, entry.state].filter(Boolean).join(', ')}`
        : [entry.address, entry.city, entry.state].filter(Boolean).join(', ')
    }
    
    return NextResponse.json(entryWithUsage)
    
  } catch (error) {
    console.error('Error fetching address book entry:', error)
    return NextResponse.json(
      { error: 'Failed to fetch address book entry' },
      { status: 500 }
    )
  }
}

// PUT /api/address-book/[id] - Update address book entry
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id)
    
    if (isNaN(id)) {
      return NextResponse.json(
        { error: 'Invalid address book entry ID' },
        { status: 400 }
      )
    }
    
    const data = await req.json()
    
    // Check if entry exists
    const existingEntry = await prisma.customerAddressBook.findUnique({
      where: { id }
    })
    
    if (!existingEntry) {
      return NextResponse.json(
        { error: 'Address book entry not found' },
        { status: 404 }
      )
    }
    
    // If customer name changed, find or create customer
    let customerId = existingEntry.customerId
    let customerName = existingEntry.customerName
    
    if (data.customerName && data.customerName.trim() !== existingEntry.customerName) {
      let customer = await prisma.customer.findFirst({
        where: { name: data.customerName.trim() }
      })
      
      if (!customer) {
        customer = await prisma.customer.create({
          data: {
            name: data.customerName.trim(),
            phone: data.customerPhone?.trim() || null,
            email: data.customerEmail?.trim() || null,
            createdDate: new Date().toISOString().split('T')[0],
            modifiedDate: new Date().toISOString().split('T')[0],
            isActive: true
          }
        })
        console.log(`Created new customer: ${customer.name}`)
      }
      
      customerId = customer.id
      customerName = customer.name
    }
    
    // If setting as default, unset other defaults of the same type for this customer
    if (data.isDefaultPickup && !existingEntry.isDefaultPickup) {
      await prisma.customerAddressBook.updateMany({
        where: { 
          customerId,
          isDefaultPickup: true,
          id: { not: id } // Don't update the current entry
        },
        data: { isDefaultPickup: false }
      })
    }
    
    if (data.isDefaultDrop && !existingEntry.isDefaultDrop) {
      await prisma.customerAddressBook.updateMany({
        where: { 
          customerId,
          isDefaultDrop: true,
          id: { not: id } // Don't update the current entry
        },
        data: { isDefaultDrop: false }
      })
    }
    
    // Build update data
    const updateData: any = {}
    
    if (data.customerName !== undefined) {
      updateData.customerId = customerId
      updateData.customerName = customerName
    }
    if (data.locationName !== undefined) updateData.locationName = data.locationName?.trim() || null
    if (data.address !== undefined) updateData.address = data.address?.trim() || null
    if (data.city !== undefined) updateData.city = data.city?.trim() || null
    if (data.state !== undefined) updateData.state = data.state?.trim() || null
    if (data.isDefaultPickup !== undefined) updateData.isDefaultPickup = data.isDefaultPickup
    if (data.isDefaultDrop !== undefined) updateData.isDefaultDrop = data.isDefaultDrop
    
    // Update the entry
    const updatedEntry = await prisma.customerAddressBook.update({
      where: { id },
      data: updateData,
      include: {
        customer: {
          select: {
            name: true,
            phone: true,
            email: true,
            isActive: true
          }
        }
      }
    })
    
    console.log(`Updated address book entry: ${updatedEntry.customerName} - ${updatedEntry.city}`)
    return NextResponse.json(updatedEntry)
    
  } catch (error) {
    console.error('Error updating address book entry:', error)
    return NextResponse.json(
      { error: 'Failed to update address book entry' },
      { status: 500 }
    )
  }
}

// DELETE /api/address-book/[id] - Delete address book entry
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id)
    
    if (isNaN(id)) {
      return NextResponse.json(
        { error: 'Invalid address book entry ID' },
        { status: 400 }
      )
    }
    
    // Check if entry exists and get info
    const entry = await prisma.customerAddressBook.findUnique({
      where: { id },
      select: { 
        customerName: true, 
        city: true,
        isDefaultPickup: true,
        isDefaultDrop: true
      }
    })
    
    if (!entry) {
      return NextResponse.json(
        { error: 'Address book entry not found' },
        { status: 404 }
      )
    }
    
    // Check if this is being used in any active loads
    const usageCount = await prisma.load.count({
      where: {
        OR: [
          { 
            AND: [
              { customer: entry.customerName },
              { pickUpLocation: { contains: entry.city || '' } }
            ]
          },
          { 
            AND: [
              { customer2: entry.customerName },
              { dropLocation: { contains: entry.city || '' } }
            ]
          }
        ],
        status: { notIn: ['DELIVERED', 'PAID', 'CANCELLED'] }
      }
    })
    
    if (usageCount > 0) {
      return NextResponse.json(
        { error: `Cannot delete address book entry. It is being used in ${usageCount} active load(s).` },
        { status: 400 }
      )
    }
    
    // Delete the entry
    await prisma.customerAddressBook.delete({
      where: { id }
    })
    
    console.log(`Deleted address book entry: ${entry.customerName} - ${entry.city}`)
    return NextResponse.json({
      message: 'Address book entry deleted successfully',
      customerName: entry.customerName,
      city: entry.city
    })
    
  } catch (error) {
    console.error('Error deleting address book entry:', error)
    return NextResponse.json(
      { error: 'Failed to delete address book entry' },
      { status: 500 }
    )
  }
}
