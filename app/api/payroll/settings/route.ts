import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'
import { todayISO } from '../../../../utils/dates'

// GET /api/payroll/settings - Get payroll settings
export async function GET(req: NextRequest) {
  try {
    // Try to get existing payroll settings from company config
    let settings = await prisma.companyConfig.findFirst({
      where: { isActive: true },
      select: {
        id: true,
        payrollFrequency: true,
        payrollDayOfWeek: true,
        autoIncludeCurrentWeek: true
      }
    })

    // If no settings exist, return defaults
    if (!settings) {
      return NextResponse.json({
        payrollFrequency: 'WEEKLY',
        payrollDayOfWeek: 5, // Friday (0 = Sunday, 1 = Monday, etc.)
        autoIncludeCurrentWeek: true
      })
    }

    return NextResponse.json({
      payrollFrequency: settings.payrollFrequency || 'WEEKLY',
      payrollDayOfWeek: settings.payrollDayOfWeek || 5,
      autoIncludeCurrentWeek: settings.autoIncludeCurrentWeek ?? true
    })
  } catch (error) {
    console.error('Error fetching payroll settings:', error)
    return NextResponse.json(
      { error: 'Failed to fetch payroll settings' },
      { status: 500 }
    )
  }
}

// POST /api/payroll/settings - Update payroll settings
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { payrollFrequency, payrollDayOfWeek, autoIncludeCurrentWeek } = body

    // Validate payroll frequency
    if (payrollFrequency && !['WEEKLY', 'BI_WEEKLY'].includes(payrollFrequency)) {
      return NextResponse.json(
        { error: 'Payroll frequency must be WEEKLY or BI_WEEKLY' },
        { status: 400 }
      )
    }

    // Validate day of week (0-6, where 0 = Sunday)
    if (payrollDayOfWeek !== undefined && (payrollDayOfWeek < 0 || payrollDayOfWeek > 6)) {
      return NextResponse.json(
        { error: 'Payroll day of week must be between 0 (Sunday) and 6 (Saturday)' },
        { status: 400 }
      )
    }

    // Try to find existing company config
    let companyConfig = await prisma.companyConfig.findFirst({
      where: { isActive: true }
    })

    if (companyConfig) {
      // Update existing config
      const updatedConfig = await prisma.companyConfig.update({
        where: { id: companyConfig.id },
        data: {
          ...(payrollFrequency !== undefined && { payrollFrequency }),
          ...(payrollDayOfWeek !== undefined && { payrollDayOfWeek }),
          ...(autoIncludeCurrentWeek !== undefined && { autoIncludeCurrentWeek }),
          modifiedDate: todayISO()
        }
      })

      return NextResponse.json({
        payrollFrequency: updatedConfig.payrollFrequency || 'WEEKLY',
        payrollDayOfWeek: updatedConfig.payrollDayOfWeek || 5,
        autoIncludeCurrentWeek: updatedConfig.autoIncludeCurrentWeek ?? true
      })
    } else {
      // Create new company config with payroll settings
      const newConfig = await prisma.companyConfig.create({
        data: {
          companyName: 'TMS Company', // Default name
          payrollFrequency: payrollFrequency || 'WEEKLY',
          payrollDayOfWeek: payrollDayOfWeek || 5,
          autoIncludeCurrentWeek: autoIncludeCurrentWeek ?? true,
          isActive: true,
          createdDate: todayISO()
        }
      })

      return NextResponse.json({
        payrollFrequency: newConfig.payrollFrequency || 'WEEKLY',
        payrollDayOfWeek: newConfig.payrollDayOfWeek || 5,
        autoIncludeCurrentWeek: newConfig.autoIncludeCurrentWeek ?? true
      })
    }
  } catch (error) {
    console.error('Error updating payroll settings:', error)
    return NextResponse.json(
      { error: 'Failed to update payroll settings' },
      { status: 500 }
    )
  }
}
