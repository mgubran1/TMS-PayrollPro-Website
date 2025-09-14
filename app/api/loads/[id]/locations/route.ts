import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { LoadLocation } from '@/lib/loads-types'

// GET /api/loads/[id]/locations - Get all locations for a load
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const loadId = parseInt(params.id)
    
    if (isNaN(loadId)) {
      return NextResponse.json(
        { error: 'Invalid load ID' },
        { status: 400 }
      )
    }
    
    // Check if load exists
    const load = await prisma.load.findUnique({
      where: { id: loadId },
      select: { id: true, loadNumber: true }
    })
    
    if (!load) {
      return NextResponse.json(
        { error: 'Load not found' },
        { status: 404 }
      )
    }
    
    const locations = await prisma.loadLocation.findMany({
      where: { loadId },
      orderBy: [
        { type: 'asc' },
        { sequence: 'asc' }
      ]
    })
    
    console.log(`Retrieved ${locations.length} locations for load: ${load.loadNumber}`)
    return NextResponse.json(locations)
    
  } catch (error) {
    console.error('Error fetching load locations:', error)
    return NextResponse.json(
      { error: 'Failed to fetch load locations' },
      { status: 500 }
    )
  }
}

// POST /api/loads/[id]/locations - Add new location to load
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const loadId = parseInt(params.id)
    
    if (isNaN(loadId)) {
      return NextResponse.json(
        { error: 'Invalid load ID' },
        { status: 400 }
      )
    }
    
    const data = await req.json()
    
    // Validate required fields
    if (!data.type || !['PICKUP', 'DROP'].includes(data.type)) {
      return NextResponse.json(
        { error: 'Valid location type (PICKUP or DROP) is required' },
        { status: 400 }
      )
    }
    
    // Check if load exists
    const load = await prisma.load.findUnique({
      where: { id: loadId },
      select: { id: true, loadNumber: true }
    })
    
    if (!load) {
      return NextResponse.json(
        { error: 'Load not found' },
        { status: 404 }
      )
    }
    
    // Get next sequence number for this type
    const maxSequence = await prisma.loadLocation.findFirst({
      where: { 
        loadId,
        type: data.type
      },
      select: { sequence: true },
      orderBy: { sequence: 'desc' }
    })
    
    const nextSequence = data.sequence || ((maxSequence?.sequence || 0) + 1)
    
    // Create the location
    const location = await prisma.loadLocation.create({
      data: {
        loadId,
        type: data.type,
        sequence: nextSequence,
        customer: data.customer?.trim() || null,
        address: data.address?.trim() || null,
        city: data.city?.trim() || null,
        state: data.state?.trim() || null,
        date: data.date || null,
        time: data.time || null,
        notes: data.notes?.trim() || null
      }
    })
    
    console.log(`Added ${data.type} location #${nextSequence} to load: ${load.loadNumber}`)
    return NextResponse.json(location)
    
  } catch (error) {
    console.error('Error adding load location:', error)
    return NextResponse.json(
      { error: 'Failed to add load location' },
      { status: 500 }
    )
  }
}

// PUT /api/loads/[id]/locations - Update multiple locations (bulk update)
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const loadId = parseInt(params.id)
    
    if (isNaN(loadId)) {
      return NextResponse.json(
        { error: 'Invalid load ID' },
        { status: 400 }
      )
    }
    
    const locations: LoadLocation[] = await req.json()
    
    if (!Array.isArray(locations)) {
      return NextResponse.json(
        { error: 'Locations must be an array' },
        { status: 400 }
      )
    }
    
    // Check if load exists
    const load = await prisma.load.findUnique({
      where: { id: loadId },
      select: { id: true, loadNumber: true }
    })
    
    if (!load) {
      return NextResponse.json(
        { error: 'Load not found' },
        { status: 404 }
      )
    }
    
    // Start transaction to update all locations
    const result = await prisma.$transaction(async (tx) => {
      // Delete existing locations
      await tx.loadLocation.deleteMany({
        where: { loadId }
      })
      
      // Create new locations
      const createdLocations = []
      for (const location of locations) {
        if (!location.type || !['PICKUP', 'DROP'].includes(location.type)) {
          throw new Error(`Invalid location type: ${location.type}`)
        }
        
        const created = await tx.loadLocation.create({
          data: {
            loadId,
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
        createdLocations.push(created)
      }
      
      return createdLocations
    })
    
    console.log(`Updated ${result.length} locations for load: ${load.loadNumber}`)
    return NextResponse.json(result)
    
  } catch (error) {
    console.error('Error updating load locations:', error)
    return NextResponse.json(
      { error: 'Failed to update load locations' },
      { status: 500 }
    )
  }
}

