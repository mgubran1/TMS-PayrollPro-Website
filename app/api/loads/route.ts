import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Load, LoadFilters, LoadCreateRequest, LoadStatus } from '@/lib/loads-types'
import { todayISO } from '@/utils/dates'

// Auto-save customer and address information
async function autoSaveCustomers(
  data: LoadCreateRequest, 
  pickup: { city: string | null, state: string | null }, 
  delivery: { city: string | null, state: string | null }
) {
  try {
    // Save pickup customer
    if (data.customer?.trim()) {
      await upsertCustomer(data.customer.trim())
      
      // Save pickup address
      if (data.pickUpLocation?.trim()) {
        await upsertCustomerAddress(
          data.customer.trim(),
          data.pickUpLocation.trim(),
          pickup.city,
          pickup.state,
          true, // isDefaultPickup
          false // isDefaultDrop
        )
      }
    }

    // Save drop customer (if different)
    if (data.customer2?.trim() && data.customer2.trim() !== data.customer?.trim()) {
      await upsertCustomer(data.customer2.trim())
    }

    // Save drop address
    if (data.dropLocation?.trim()) {
      const dropCustomer = data.customer2?.trim() || data.customer?.trim()
      if (dropCustomer) {
        await upsertCustomerAddress(
          dropCustomer,
          data.dropLocation.trim(),
          delivery.city,
          delivery.state,
          false, // isDefaultPickup
          true // isDefaultDrop
        )
      }
    }

    // Save billing entity
    if (data.billTo?.trim() && data.billTo.trim() !== data.customer?.trim() && data.billTo.trim() !== data.customer2?.trim()) {
      await upsertBillingEntity(data.billTo.trim())
    }
  } catch (error) {
    console.warn('Error auto-saving customer data:', error)
    // Don't fail the load creation if customer auto-save fails
  }
}

// Upsert customer
async function upsertCustomer(customerName: string) {
  const existingCustomer = await prisma.customer.findFirst({
    where: { 
      name: customerName
    }
  })

  if (!existingCustomer) {
    await prisma.customer.create({
      data: {
        name: customerName,
        isActive: true,
        createdDate: todayISO(),
        modifiedDate: todayISO()
      }
    })
    console.log(`Auto-saved customer: ${customerName}`)
  }
}

// Upsert customer address
async function upsertCustomerAddress(
  customerName: string,
  address: string,
  city: string | null,
  state: string | null,
  isDefaultPickup: boolean,
  isDefaultDrop: boolean
) {
  // Find customer
  const customer = await prisma.customer.findFirst({
    where: { 
      name: customerName
    }
  })

  if (!customer) return

  // Check if address already exists
  const existingAddress = await prisma.customerAddressBook.findFirst({
    where: {
      customerId: customer.id,
      address: address
    }
  })

  if (!existingAddress) {
    await prisma.customerAddressBook.create({
      data: {
        customerId: customer.id,
        customerName: customerName,
        address: address,
        city: city,
        state: state,
        isDefaultPickup: isDefaultPickup,
        isDefaultDrop: isDefaultDrop
      }
    })
    console.log(`Auto-saved address for ${customerName}: ${address}`)
  }
}

// Upsert billing entity
async function upsertBillingEntity(billingName: string) {
  const existingEntity = await prisma.billingEntity.findFirst({
    where: { 
      name: billingName
    }
  })

  if (!existingEntity) {
    await prisma.billingEntity.create({
      data: {
        name: billingName,
        isActive: true,
        createdDate: todayISO(),
        modifiedDate: todayISO()
      }
    })
    console.log(`Auto-saved billing entity: ${billingName}`)
  }
}

// Generate next sequential load number
async function generateNextLoadNumber(): Promise<string> {
  // Get the latest load number with LD- prefix
  const latestLoad = await prisma.load.findFirst({
    where: {
      loadNumber: {
        startsWith: 'LD-'
      }
    },
    orderBy: {
      id: 'desc' // Use ID for reliable ordering
    },
    select: {
      loadNumber: true
    }
  })

  if (!latestLoad) {
    // First load ever
    return 'LD-1001'
  }

  // Extract number part and increment
  const numberPart = latestLoad.loadNumber.replace('LD-', '')
  const nextNumber = parseInt(numberPart) + 1
  
  // Ensure it doesn't go below 1001
  const finalNumber = Math.max(nextNumber, 1001)
  
  return `LD-${finalNumber}`
}

// Helper function to build where clause from filters
function buildWhereClause(filters: LoadFilters) {
  const where: any = {}
  
  // Status filter
  if (filters.status && filters.status !== 'ALL') {
    where.status = filters.status
  }
  
  // Date range filter
  if (filters.dateFrom || filters.dateTo) {
    where.deliveryDate = {}
    if (filters.dateFrom) {
      where.deliveryDate.gte = filters.dateFrom
    }
    if (filters.dateTo) {
      where.deliveryDate.lte = filters.dateTo
    }
  }
  
  // Driver filter
  if (filters.driverId) {
    where.driverId = filters.driverId
  }
  
  // Trailer filter
  if (filters.trailerId) {
    where.trailerId = filters.trailerId
  }
  
  // Gross amount range
  if (filters.grossMin !== undefined || filters.grossMax !== undefined) {
    where.grossAmount = {}
    if (filters.grossMin !== undefined) {
      where.grossAmount.gte = filters.grossMin
    }
    if (filters.grossMax !== undefined) {
      where.grossAmount.lte = filters.grossMax
    }
  }
  
  // Customer filter
  if (filters.customer) {
    where.OR = [
      { customer: { contains: filters.customer } },
      { customer2: { contains: filters.customer } }
    ]
  }
  
  // Bill To filter
  if (filters.billTo) {
    where.billTo = { contains: filters.billTo }
  }
  
  // Quick search across multiple fields
  if (filters.quickSearch && filters.quickSearch.trim()) {
    const searchTerm = filters.quickSearch.trim()
    where.OR = [
      { loadNumber: { contains: searchTerm } },
      { poNumber: { contains: searchTerm } },
      { customer: { contains: searchTerm } },
      { customer2: { contains: searchTerm } },
      { billTo: { contains: searchTerm } },
      { notes: { contains: searchTerm } },
      { pickUpLocation: { contains: searchTerm } },
      { dropLocation: { contains: searchTerm } }
    ]
  }
  
  // Late only filter
  if (filters.lateOnly) {
    where.status = { in: ['PICKUP_LATE', 'DELIVERY_LATE'] }
  }
  
  return where
}

// GET /api/loads - Get loads with filters and pagination
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    
    // Parse filters from query parameters
    const filters: LoadFilters = {
      status: searchParams.get('status') as LoadStatus || 'ALL',
      dateFrom: searchParams.get('dateFrom') || undefined,
      dateTo: searchParams.get('dateTo') || undefined,
      driverId: searchParams.get('driverId') ? parseInt(searchParams.get('driverId')!) : undefined,
      trailerId: searchParams.get('trailerId') ? parseInt(searchParams.get('trailerId')!) : undefined,
      grossMin: searchParams.get('grossMin') ? parseFloat(searchParams.get('grossMin')!) : undefined,
      grossMax: searchParams.get('grossMax') ? parseFloat(searchParams.get('grossMax')!) : undefined,
      quickSearch: searchParams.get('quickSearch') || undefined,
      lateOnly: searchParams.get('lateOnly') === 'true',
      customer: searchParams.get('customer') || undefined,
      billTo: searchParams.get('billTo') || undefined
    }
    
    // Pagination parameters
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = (page - 1) * limit
    
    // Sorting parameters
    const sortBy = searchParams.get('sortBy') || 'deliveryDate'
    const sortOrder = searchParams.get('sortOrder') || 'desc'
    
    // Build where clause
    const where = buildWhereClause(filters)
    
    // Get total count for pagination
    const total = await prisma.load.count({ where })
    
    // Get loads without foreign key relations (handle manually)
    const loads = await prisma.load.findMany({
      where,
      include: {
        locations: {
          orderBy: [
            { type: 'asc' },
            { sequence: 'asc' }
          ]
        },
        documents: {
          select: {
            id: true,
            fileName: true,
            type: true,
            uploadDate: true,
            fileSize: true
          }
        }
      },
      orderBy: {
        [sortBy]: sortOrder
      },
      skip: offset,
      take: limit
    })

    // Manually fetch employee and trailer data for each load
    const loadsWithRelations = await Promise.all(
      loads.map(async (load) => {
        let employee = null
        let trailer = null

        // Fetch employee if driverId exists and is valid
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

        // Fetch trailer if trailerId exists and is valid
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

        return {
          ...load,
          employee,
          trailer
        }
      })
    )
    
    // Calculate summary statistics
    const summary = {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      totalGrossAmount: loadsWithRelations.reduce((sum, load) => sum + load.grossAmount, 0),
      statusBreakdown: loadsWithRelations.reduce((acc, load) => {
        acc[load.status as LoadStatus] = (acc[load.status as LoadStatus] || 0) + 1
        return acc
      }, {} as Record<LoadStatus, number>)
    }
    
    console.log(`Retrieved ${loadsWithRelations.length} loads (page ${page}/${summary.totalPages})`)
    
    return NextResponse.json({
      loads: loadsWithRelations,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      },
      summary: {
        totalGrossAmount: loadsWithRelations.reduce((sum, load) => sum + load.grossAmount, 0),
        statusBreakdown: loadsWithRelations.reduce((acc, load) => {
          acc[load.status as LoadStatus] = (acc[load.status as LoadStatus] || 0) + 1
          return acc
        }, {} as Record<LoadStatus, number>)
      },
      filters: filters
    })
    
  } catch (error) {
    console.error('Error fetching loads:', error)
    return NextResponse.json(
      { error: 'Failed to fetch loads' },
      { status: 500 }
    )
  }
}

// POST /api/loads - Create new load
export async function POST(req: NextRequest) {
  try {
    const data: LoadCreateRequest = await req.json()
    
    // Validate required fields
    if (!data.loadNumber?.trim()) {
      return NextResponse.json(
        { error: 'Load number is required' },
        { status: 400 }
      )
    }
    
    if (!data.customer?.trim()) {
      return NextResponse.json(
        { error: 'Customer is required' },
        { status: 400 }
      )
    }
    
    // Check for duplicate load number
    const existingLoad = await prisma.load.findUnique({
      where: { loadNumber: data.loadNumber }
    })
    
    if (existingLoad) {
      return NextResponse.json(
        { error: 'Load number already exists' },
        { status: 409 }
      )
    }
    
    // Get driver information if driverId provided
    let driverName = null
    let truckUnitSnapshot = null
    if (data.driverId) {
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
      }
    }
    
    // Get trailer information if trailerId provided
    let trailerNumber = null
    if (data.trailerId) {
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
      }
    }
    
    // Calculate driver rate (default 75% of gross)
    const driverRate = data.driverRate ?? (data.grossAmount * 0.75)
    
    // Parse location fields from combined location strings
    const parseLocation = (location?: string) => {
      if (!location) return { city: null, state: null }
      const parts = location.split(',').map(p => p.trim())
      return {
        city: parts[0] || null,
        state: parts[1] || null
      }
    }
    
    const pickup = parseLocation(data.pickUpLocation)
    const delivery = parseLocation(data.dropLocation)
    
    // Generate sequential load number if not provided
    if (!data.loadNumber || data.loadNumber.startsWith('LD') && data.loadNumber.length < 7) {
      data.loadNumber = await generateNextLoadNumber()
    }

    // Check for duplicate PO number if provided
    if (data.poNumber && data.poNumber.trim()) {
      const existingLoad = await prisma.load.findFirst({
        where: {
          poNumber: data.poNumber.trim(),
          // Exclude current load if editing
          ...(data.id ? { id: { not: data.id } } : {})
        },
        select: {
          id: true,
          loadNumber: true,
          customer: true
        }
      })
      
      if (existingLoad) {
        return NextResponse.json({
          error: `Duplicate PO Number: "${data.poNumber}" is already used by Load #${existingLoad.loadNumber} for ${existingLoad.customer}`,
          duplicate: true,
          existingLoad: {
            loadNumber: existingLoad.loadNumber,
            customer: existingLoad.customer
          }
        }, { status: 409 })
      }
    }

    // Auto-save customer information
    await autoSaveCustomers(data, pickup, delivery)
    
    // Prepare load data - completely avoid foreign key relations
    const loadData = {
      loadNumber: data.loadNumber.trim(),
      poNumber: data.poNumber?.trim() || null,
      customer: data.customer.trim(),
      customer2: data.customer2?.trim() || null,
      billTo: data.billTo?.trim() || null,
      
      pickUpLocation: data.pickUpLocation?.trim() || null,
      dropLocation: data.dropLocation?.trim() || null,
      pickUpDate: data.pickUpDate || null,
      pickUpTime: data.pickUpTime || null,
      deliveryDate: data.deliveryDate || null,
      deliveryTime: data.deliveryTime || null,
      
      pickupCity: pickup.city,
      pickupState: pickup.state,
      deliveryCity: delivery.city,
      deliveryState: delivery.state,
      
      // Store IDs as simple numbers without relations
      driverId: data.driverId || 0,
      driverName: driverName,
      truckUnitSnapshot: truckUnitSnapshot,
      trailerId: data.trailerId || 0,
      trailerNumber: trailerNumber,
      
      status: data.status,
      grossAmount: data.grossAmount,
      driverRate: driverRate,
      
      notes: data.notes?.trim() || null,
      reminder: data.reminder?.trim() || null,
      
      hasLumper: data.hasLumper || false,
      lumperAmount: data.lumperAmount || 0,
      hasRevisedRateConfirmation: data.hasRevisedRateConfirmation || false,
      
      createdDate: todayISO(),
      modifiedDate: todayISO(),
      modifiedBy: 'web'
    }

    // Create the load without include relations to avoid foreign key issues
    const load = await prisma.load.create({
      data: loadData
    })

    // AUTO-CALCULATE PAYMENT for new loads if driver is assigned
    if (load.driverId && load.driverId > 0 && load.grossAmount > 0) {
      try {
        console.log(`Auto-calculating payment for new load ${load.loadNumber}`)
        
        const calculationResponse = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/loads/payment-calculation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            loadId: load.id,
            driverId: load.driverId
          })
        });

        if (calculationResponse.ok) {
          const paymentResult = await calculationResponse.json();
          
          // Update load with calculated payment information
          await prisma.load.update({
            where: { id: load.id },
            data: {
              driverRate: paymentResult.driverRate,
              paymentMethod: paymentResult.paymentMethod,
              calculatedMiles: paymentResult.calculatedMiles || 0,
              adjustedMiles: paymentResult.adjustedMiles || 0,
              finalMiles: paymentResult.finalMiles || 0,
              payPerMileRate: paymentResult.payPerMileRate || 0,
              paymentCalculatedAt: new Date().toISOString(),
              paymentCalculatedBy: 'auto-system'
            }
          });

          console.log(`Payment auto-calculated for load ${load.loadNumber}: Driver Rate $${paymentResult.driverRate}`);
        }
      } catch (error) {
        console.warn(`Failed to auto-calculate payment for load ${load.loadNumber}:`, error);
        // Don't fail the load creation if payment calculation fails
      }
    }

    // Manually fetch employee and trailer data if needed for the response
    let employeeData = null
    let trailerData = null
    
    if (loadData.driverId && loadData.driverId > 0) {
      employeeData = await prisma.employee.findUnique({
        where: { id: loadData.driverId },
        select: { id: true, name: true, truckUnit: true }
      })
    }
    
    if (loadData.trailerId && loadData.trailerId > 0) {
      trailerData = await prisma.trailer.findUnique({
        where: { id: loadData.trailerId },
        select: { id: true, trailerNumber: true }
      })
    }

    // Add the related data to the response
    const loadWithRelations = {
      ...load,
      employee: employeeData,
      trailer: trailerData
    }
    
    // Create additional locations if provided
    if (data.locations && data.locations.length > 0) {
      for (const location of data.locations) {
        await prisma.loadLocation.create({
          data: {
            loadId: load.id,
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
    
    console.log(`Created new load: ${load.loadNumber}`)
    return NextResponse.json(loadWithRelations)
    
  } catch (error) {
    console.error('Error creating load:', error)
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json(
        { error: 'Load number already exists' },
        { status: 409 }
      )
    }
    return NextResponse.json(
      { error: 'Failed to create load' },
      { status: 500 }
    )
  }
}
