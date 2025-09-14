import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * Optimized API endpoint for Load Form dropdown data
 * Returns only essential fields needed for employee and trailer selection
 * Following Next.js data fetching best practices
 */

export async function GET(req: NextRequest) {
  try {
    // Start both queries in parallel for optimal performance
    const employeesPromise = prisma.employee.findMany({
      where: { 
        status: 'ACTIVE' 
      },
      select: {
        id: true,
        name: true,
        truckUnit: true,
        status: true,
        trailerNumber: true // Employee's assigned trailer number (string)
      },
      orderBy: { name: 'asc' }
    })
    
    const trailersPromise = prisma.trailer.findMany({
      where: {
        OR: [
          { status: 'ACTIVE' },
          { status: 'AVAILABLE' }
        ]
      },
      select: {
        id: true,
        trailerNumber: true,
        status: true,
        type: true,
        isAssigned: true,
        assignedDriver: true
      },
      orderBy: { trailerNumber: 'asc' }
    })
    
    // Wait for both queries to complete
    const [employees, trailers] = await Promise.all([
      employeesPromise,
      trailersPromise
    ])
    
    // Filter and format data for optimal dropdown performance
    const activeEmployees = employees.map(emp => ({
      id: emp.id,
      name: emp.name,
      truckUnit: emp.truckUnit,
      status: emp.status,
      // Include trailer info for auto-assignment (stored as string reference)
      trailerNumber: emp.trailerNumber
    }))
    
    const availableTrailers = trailers.map(trailer => ({
      id: trailer.id,
      trailerNumber: trailer.trailerNumber,
      status: trailer.status,
      type: trailer.type,
      isAssigned: trailer.isAssigned,
      assignedDriver: trailer.assignedDriver
    }))
    
    console.log(`🚛 Load Form Dropdown Data:`)
    console.log(`   - ${activeEmployees.length} active employees`)
    console.log(`   - ${availableTrailers.length} available trailers`)
    
    return NextResponse.json({
      employees: activeEmployees,
      trailers: availableTrailers,
      success: true,
      timestamp: new Date().toISOString(),
      counts: {
        employees: activeEmployees.length,
        trailers: availableTrailers.length
      }
    })
    
  } catch (error) {
    console.error('❌ Error fetching load form dropdown data:', error)
    
    return NextResponse.json({
      employees: [],
      trailers: [],
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch dropdown data',
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
}

/**
 * GET /api/loads/dropdown-data?refresh=true
 * Optional refresh parameter to bypass any potential caching
 */
export const dynamic = 'force-dynamic' // Ensure fresh data
