import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET - Get unique filter options from existing fuel transactions
export async function GET() {
  try {
    // Get unique driver names and units from fuel transactions
    const [driverNamesResult, unitsResult] = await Promise.all([
      prisma.fuelTransaction.findMany({
        select: { driverName: true },
        distinct: ['driverName'],
        orderBy: { driverName: 'asc' }
      }),
      prisma.fuelTransaction.findMany({
        select: { unit: true },
        distinct: ['unit'],
        orderBy: { unit: 'asc' }
      })
    ])

    // Also get employee data to merge with fuel transaction data
    const employees = await prisma.employee.findMany({
      select: { name: true, truckUnit: true }
    })

    // Combine and deduplicate driver names
    const fuelDriverNames = driverNamesResult.map(t => t.driverName).filter(name => name)
    const employeeNames = employees.map(e => e.name).filter(name => name)
    const allDriverNames = [...new Set([...fuelDriverNames, ...employeeNames])].sort()

    // Combine and deduplicate truck units
    const fuelUnits = unitsResult.map(t => t.unit).filter(unit => unit)
    const employeeUnits = employees.map(e => e.truckUnit).filter(unit => unit)
    const allUnits = [...new Set([...fuelUnits, ...employeeUnits])].sort()

    const result = {
      driverNames: allDriverNames,
      units: allUnits,
      employeesCount: employees.length,
      fuelTransactionsWithDrivers: fuelDriverNames.length,
      fuelTransactionsWithUnits: fuelUnits.length
    }

    console.log(`Returning filter options - ${result.driverNames.length} drivers, ${result.units.length} units`)
    return NextResponse.json(result)
  } catch (error) {
    console.error('Error fetching filter options:', error)
    return NextResponse.json({ 
      error: 'Failed to fetch filter options',
      driverNames: [],
      units: []
    }, { status: 500 })
  }
}
