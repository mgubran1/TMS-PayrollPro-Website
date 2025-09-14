import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// POST /api/payroll/week-lock - Lock or unlock a payroll week
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { year, week, locked, lockedBy } = body

    if (!year || !week || locked === undefined) {
      return NextResponse.json(
        { error: 'Year, week, and locked status are required' },
        { status: 400 }
      )
    }

    console.log(`${locked ? 'Locking' : 'Unlocking'} Week ${week}, ${year}`)

    // Calculate the date range for the week
    const { startDate, endDate } = getWeekDates(year, week)

    // Update all individual payroll records for this week
    const updateResult = await prisma.individualPayroll.updateMany({
      where: {
        weekStartDate: startDate,
        weekEndDate: endDate
      },
      data: {
        isLocked: locked,
        modifiedDate: new Date().toISOString(),
        ...(locked && {
          reviewedDate: new Date().toISOString(),
          reviewedBy: lockedBy
        })
      }
    })

    // Log the action for audit purposes
    console.log(`${locked ? 'Locked' : 'Unlocked'} ${updateResult.count} payroll records for Week ${week}, ${year}`)

    // Create audit log entry
    try {
      await createWeekLockAuditEntry(year, week, locked, lockedBy, updateResult.count)
    } catch (auditError) {
      console.warn('Failed to create audit entry:', auditError)
      // Don't fail the request if audit logging fails
    }

    return NextResponse.json({
      success: true,
      message: `Week ${week}, ${year} has been ${locked ? 'locked' : 'unlocked'}`,
      affectedRecords: updateResult.count,
      weekKey: `${year}-W${week.toString().padStart(2, '0')}`,
      locked,
      lockedBy,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('Error updating week lock status:', error)
    return NextResponse.json(
      { error: 'Failed to update week lock status' },
      { status: 500 }
    )
  }
}

// GET /api/payroll/week-lock - Get lock status for multiple weeks
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const year = parseInt(searchParams.get('year') || new Date().getFullYear().toString())
    const startWeek = parseInt(searchParams.get('startWeek') || '1')
    const endWeek = parseInt(searchParams.get('endWeek') || '52')

    const weekLocks = new Map<string, any>()

    // Get lock status for the requested range of weeks
    for (let week = startWeek; week <= endWeek; week++) {
      const { startDate, endDate } = getWeekDates(year, week)
      
      // Check if any payroll records for this week are locked
      const lockedCount = await prisma.individualPayroll.count({
        where: {
          weekStartDate: startDate,
          weekEndDate: endDate,
          isLocked: true
        }
      })

      const totalCount = await prisma.individualPayroll.count({
        where: {
          weekStartDate: startDate,
          weekEndDate: endDate
        }
      })

      const weekKey = `${year}-W${week.toString().padStart(2, '0')}`
      weekLocks.set(weekKey, {
        year,
        week,
        weekKey,
        isLocked: lockedCount > 0,
        lockedCount,
        totalCount,
        partiallyLocked: lockedCount > 0 && lockedCount < totalCount,
        startDate,
        endDate
      })
    }

    return NextResponse.json({
      weekLocks: Array.from(weekLocks.entries()).map(([key, value]) => ({ key, ...value })),
      year,
      startWeek,
      endWeek
    })

  } catch (error) {
    console.error('Error fetching week lock status:', error)
    return NextResponse.json(
      { error: 'Failed to fetch week lock status' },
      { status: 500 }
    )
  }
}

// Helper function to get week start and end dates
function getWeekDates(year: number, week: number): { startDate: string, endDate: string } {
  // Get the first day of the year
  const startOfYear = new Date(year, 0, 1)
  
  // Calculate the start of the specified week
  const daysToAdd = (week - 1) * 7
  const weekStart = new Date(startOfYear.getTime() + daysToAdd * 24 * 60 * 60 * 1000)
  
  // Adjust to Monday (start of week)
  const dayOfWeek = weekStart.getDay()
  const diff = weekStart.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1)
  const monday = new Date(weekStart.setDate(diff))
  
  // Calculate Sunday (end of week)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  
  return {
    startDate: monday.toISOString().split('T')[0],
    endDate: sunday.toISOString().split('T')[0]
  }
}

// Helper function to create audit entry for week locking
async function createWeekLockAuditEntry(
  year: number, 
  week: number, 
  locked: boolean, 
  lockedBy: string, 
  affectedRecords: number
): Promise<void> {
  // For now, we'll just log to console
  // In a production system, you'd want to store this in an audit table
  
  const auditEntry = {
    action: locked ? 'WEEK_LOCKED' : 'WEEK_UNLOCKED',
    year,
    week,
    weekKey: `${year}-W${week.toString().padStart(2, '0')}`,
    performedBy: lockedBy,
    affectedRecords,
    timestamp: new Date().toISOString(),
    details: `Week ${week}, ${year} was ${locked ? 'locked' : 'unlocked'} by ${lockedBy}, affecting ${affectedRecords} payroll records`
  }
  
  console.log('AUDIT LOG:', JSON.stringify(auditEntry, null, 2))
  
  // TODO: Implement proper audit logging to database
  // await prisma.auditLog.create({ data: auditEntry })
}
