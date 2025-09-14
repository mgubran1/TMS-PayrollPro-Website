// Payroll utility functions for date calculations and load management

/**
 * Get the current week's date range (Monday to Sunday)
 */
export function getCurrentWeekRange(): { startDate: string; endDate: string } {
  const now = new Date()
  const currentDay = now.getDay() // 0 = Sunday, 1 = Monday, etc.
  
  // Calculate Monday of current week
  const mondayOffset = currentDay === 0 ? -6 : 1 - currentDay // If Sunday, go back 6 days
  const monday = new Date(now)
  monday.setDate(now.getDate() + mondayOffset)
  monday.setHours(0, 0, 0, 0)
  
  // Calculate Sunday of current week
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)
  
  return {
    startDate: monday.toISOString().split('T')[0], // YYYY-MM-DD format
    endDate: sunday.toISOString().split('T')[0]
  }
}

/**
 * Get the current bi-weekly period (every other Monday)
 */
export function getCurrentBiWeeklyRange(): { startDate: string; endDate: string } {
  const { startDate } = getCurrentWeekRange()
  const monday = new Date(startDate)
  
  // Calculate the epoch Monday (Jan 1, 2024 was a Monday)
  const epochMonday = new Date('2024-01-01')
  
  // Calculate weeks since epoch
  const weeksSinceEpoch = Math.floor((monday.getTime() - epochMonday.getTime()) / (7 * 24 * 60 * 60 * 1000))
  
  // Determine if this is an even or odd bi-weekly period
  const isEvenBiWeek = weeksSinceEpoch % 2 === 0
  
  let biWeekStart: Date
  if (isEvenBiWeek) {
    biWeekStart = new Date(monday) // Current Monday
  } else {
    biWeekStart = new Date(monday)
    biWeekStart.setDate(monday.getDate() - 7) // Previous Monday
  }
  
  const biWeekEnd = new Date(biWeekStart)
  biWeekEnd.setDate(biWeekStart.getDate() + 13) // 14 days later (2 weeks)
  
  return {
    startDate: biWeekStart.toISOString().split('T')[0],
    endDate: biWeekEnd.toISOString().split('T')[0]
  }
}

/**
 * Check if a date falls within the current pay period based on frequency
 */
export function isInCurrentPayPeriod(date: string, frequency: 'WEEKLY' | 'BI_WEEKLY'): boolean {
  const checkDate = new Date(date)
  let currentPeriod: { startDate: string; endDate: string }
  
  if (frequency === 'WEEKLY') {
    currentPeriod = getCurrentWeekRange()
  } else {
    currentPeriod = getCurrentBiWeeklyRange()
  }
  
  const periodStart = new Date(currentPeriod.startDate)
  const periodEnd = new Date(currentPeriod.endDate)
  
  return checkDate >= periodStart && checkDate <= periodEnd
}

/**
 * Generate period name based on frequency and date
 */
export function generatePeriodName(startDate: string, frequency: 'WEEKLY' | 'BI_WEEKLY'): string {
  const start = new Date(startDate)
  const options: Intl.DateTimeFormatOptions = { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  }
  
  if (frequency === 'WEEKLY') {
    return `Week of ${start.toLocaleDateString('en-US', options)}`
  } else {
    const end = new Date(startDate)
    end.setDate(start.getDate() + 13)
    return `Bi-Weekly ${start.toLocaleDateString('en-US', options)} - ${end.toLocaleDateString('en-US', options)}`
  }
}

/**
 * Get next pay date based on frequency and period start
 */
export function calculatePayDate(startDate: string, frequency: 'WEEKLY' | 'BI_WEEKLY'): string {
  const start = new Date(startDate)
  let payDate: Date
  
  if (frequency === 'WEEKLY') {
    // Pay on Friday after the work week ends
    payDate = new Date(start)
    payDate.setDate(start.getDate() + 4) // Monday + 4 = Friday
  } else {
    // Pay on Friday after bi-weekly period ends
    payDate = new Date(start)
    payDate.setDate(start.getDate() + 18) // 2 weeks + 4 days = Friday after 2nd week
  }
  
  return payDate.toISOString().split('T')[0]
}

/**
 * Check if an employee has delivered loads in current period
 */
export async function hasCurrentPeriodLoads(
  employeeId: number, 
  frequency: 'WEEKLY' | 'BI_WEEKLY',
  prisma: any
): Promise<boolean> {
  let currentPeriod: { startDate: string; endDate: string }
  
  if (frequency === 'WEEKLY') {
    currentPeriod = getCurrentWeekRange()
  } else {
    currentPeriod = getCurrentBiWeeklyRange()
  }
  
  const loadCount = await prisma.load.count({
    where: {
      driverId: employeeId,
      status: 'DELIVERED',
      deliveryDate: {
        gte: currentPeriod.startDate,
        lte: currentPeriod.endDate
      }
    }
  })
  
  return loadCount > 0
}

/**
 * Get all employees who have delivered loads in the current period
 */
export async function getEmployeesWithCurrentPeriodLoads(
  frequency: 'WEEKLY' | 'BI_WEEKLY',
  prisma: any
): Promise<number[]> {
  let currentPeriod: { startDate: string; endDate: string }
  
  if (frequency === 'WEEKLY') {
    currentPeriod = getCurrentWeekRange()
  } else {
    currentPeriod = getCurrentBiWeeklyRange()
  }
  
  const loads = await prisma.load.findMany({
    where: {
      status: 'DELIVERED',
      deliveryDate: {
        gte: currentPeriod.startDate,
        lte: currentPeriod.endDate
      }
    },
    select: {
      driverId: true
    },
    distinct: ['driverId']
  })
  
  return loads.map(load => load.driverId).filter(Boolean)
}
