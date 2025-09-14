import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * Debug endpoint to check employee and trailer data in database
 * Helps diagnose dropdown issues
 */

export async function GET() {
  try {
    // Check all employees
    const allEmployees = await prisma.employee.findMany({
      select: {
        id: true,
        name: true,
        status: true,
        truckUnit: true,
        trailerNumber: true
      },
      orderBy: { id: 'asc' }
    })
    
    // Check all trailers
    const allTrailers = await prisma.trailer.findMany({
      select: {
        id: true,
        trailerNumber: true,
        status: true,
        type: true,
        isAssigned: true,
        assignedDriver: true
      },
      orderBy: { id: 'asc' }
    })
    
    // Filter active employees
    const activeEmployees = allEmployees.filter(emp => emp.status === 'ACTIVE')
    
    // Filter available trailers
    const availableTrailers = allTrailers.filter(trailer => 
      trailer.status === 'ACTIVE' || trailer.status === 'AVAILABLE'
    )
    
    // Count statuses
    const employeeStatusCounts = allEmployees.reduce((acc: any, emp) => {
      acc[emp.status] = (acc[emp.status] || 0) + 1
      return acc
    }, {})
    
    const trailerStatusCounts = allTrailers.reduce((acc: any, trailer) => {
      acc[trailer.status] = (acc[trailer.status] || 0) + 1
      return acc
    }, {})
    
    console.log('🔍 Database Data Check Results:')
    console.log(`   - Total Employees: ${allEmployees.length}`)
    console.log(`   - Active Employees: ${activeEmployees.length}`)
    console.log(`   - Total Trailers: ${allTrailers.length}`)
    console.log(`   - Available Trailers: ${availableTrailers.length}`)
    console.log(`   - Employee Status Distribution:`, employeeStatusCounts)
    console.log(`   - Trailer Status Distribution:`, trailerStatusCounts)
    
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      summary: {
        totalEmployees: allEmployees.length,
        activeEmployees: activeEmployees.length,
        totalTrailers: allTrailers.length,
        availableTrailers: availableTrailers.length,
        employeeStatusCounts,
        trailerStatusCounts
      },
      data: {
        allEmployees,
        activeEmployees,
        allTrailers,
        availableTrailers
      }
    })
    
  } catch (error) {
    console.error('❌ Error in database data check:', error)
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Database check failed',
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
}

