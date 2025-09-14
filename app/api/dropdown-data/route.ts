import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type');

  try {
    switch (type) {
      case 'employees':
        // Get all active employees for driver assignment dropdowns
        const employees = await prisma.employee.findMany({
          where: { status: 'ACTIVE' },
          select: { id: true, name: true, driverType: true },
          orderBy: { name: 'asc' }
        });
        return NextResponse.json(employees);

      case 'trucks':
        // Get all trucks for employee assignment dropdowns
        const trucks = await prisma.truck.findMany({
          select: { 
            id: true, 
            number: true, 
            status: true, 
            assigned: true, 
            driver: true,
            make: true,
            model: true 
          },
          orderBy: { number: 'asc' }
        });
        return NextResponse.json(trucks);

      case 'trailers':
        // Get all trailers for employee assignment dropdowns
        const trailers = await prisma.trailer.findMany({
          select: { 
            id: true, 
            trailerNumber: true, 
            status: true, 
            isAssigned: true, 
            assignedDriver: true,
            make: true,
            model: true,
            type: true 
          },
          orderBy: { trailerNumber: 'asc' }
        });
        return NextResponse.json(trailers);

      case 'available-trucks':
        // Get only available/unassigned trucks
        const availableTrucks = await prisma.truck.findMany({
          where: { 
            OR: [
              { assigned: false },
              { driver: null },
              { status: 'AVAILABLE' }
            ]
          },
          select: { 
            id: true, 
            number: true, 
            status: true, 
            make: true, 
            model: true,
            year: true
          },
          orderBy: { number: 'asc' }
        });
        return NextResponse.json(availableTrucks);

      case 'available-trailers':
        // Get only available/unassigned trailers
        const availableTrailers = await prisma.trailer.findMany({
          where: { 
            OR: [
              { isAssigned: false },
              { assignedDriver: null },
              { status: 'AVAILABLE' }
            ]
          },
          select: { 
            id: true, 
            trailerNumber: true, 
            status: true, 
            make: true, 
            model: true,
            type: true
          },
          orderBy: { trailerNumber: 'asc' }
        });
        return NextResponse.json(availableTrailers);

    case 'customers':
      data = await prisma.customer.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          phone: true,
          email: true
        },
        orderBy: { name: 'asc' }
      })
      console.log(`Retrieved ${data.length} customers`)
      break

    case 'billing-entities':
      data = await prisma.billingEntity.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          phone: true,
          email: true
        },
        orderBy: { name: 'asc' }
      })
      console.log(`Retrieved ${data.length} billing entities`)
      break

    case 'load-statuses':
      data = [
        { value: 'BOOKED', label: 'Booked', color: '#3B82F6' },
        { value: 'ASSIGNED', label: 'Assigned', color: '#8B5CF6' },
        { value: 'IN_TRANSIT', label: 'In Transit', color: '#F59E0B' },
        { value: 'DELIVERED', label: 'Delivered', color: '#10B981' },
        { value: 'PAID', label: 'Paid', color: '#059669' },
        { value: 'CANCELLED', label: 'Cancelled', color: '#EF4444' },
        { value: 'PICKUP_LATE', label: 'Pickup Late', color: '#DC2626' },
        { value: 'DELIVERY_LATE', label: 'Delivery Late', color: '#B91C1C' }
      ]
      console.log(`Retrieved ${data.length} load statuses`)
      break

    case 'document-types':
      data = [
        { value: 'RATE_CONFIRMATION', label: 'Rate Confirmation' },
        { value: 'BOL', label: 'Bill of Lading' },
        { value: 'POD', label: 'Proof of Delivery' },
        { value: 'LUMPER', label: 'Lumper Receipt' },
        { value: 'OTHER', label: 'Other' }
      ]
      console.log(`Retrieved ${data.length} document types`)
      break

    case 'address-book':
      // Get address book entries with usage stats
      const addressEntries = await prisma.customerAddressBook.findMany({
        include: {
          customer: {
            select: { name: true, isActive: true }
          }
        },
        orderBy: [
          { customerName: 'asc' },
          { city: 'asc' }
        ]
      })

      // Add usage statistics and format for dropdown
      data = await Promise.all(
        addressEntries.map(async (entry) => {
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

          const fullAddress = [entry.address, entry.city, entry.state]
            .filter(Boolean)
            .join(', ')

          return {
            id: entry.id,
            customerName: entry.customerName,
            locationName: entry.locationName,
            fullAddress,
            city: entry.city,
            state: entry.state,
            isDefaultPickup: entry.isDefaultPickup,
            isDefaultDrop: entry.isDefaultDrop,
            usageCount,
            displayText: entry.locationName 
              ? `${entry.locationName} - ${fullAddress}`
              : fullAddress,
            customer: entry.customer
          }
        })
      )
      
      console.log(`Retrieved ${data.length} address book entries`)
      break

    default:
      return NextResponse.json({ error: 'Invalid type parameter' }, { status: 400 });
    }
  } catch (error) {
    console.error('Dropdown data API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
