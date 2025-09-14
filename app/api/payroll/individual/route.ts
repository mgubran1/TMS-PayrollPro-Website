import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'
import { todayISO } from '../../../../utils/dates'

// GET /api/payroll/individual - Get individual payroll records with filtering
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const employeeId = searchParams.get('employeeId')
    const weekStartDate = searchParams.get('weekStartDate')
    const status = searchParams.get('status') || 'ALL'
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    
    const offset = (page - 1) * limit
    
    // Build where clause
    const where: any = {}
    
    if (employeeId) {
      where.employeeId = parseInt(employeeId)
    }
    
    if (weekStartDate) {
      where.weekStartDate = weekStartDate
    }
    
    if (status !== 'ALL') {
      where.status = status
    }
    
    // Get total count
    let total = 0
    try {
      total = await prisma.individualPayroll.count({ where })
    } catch (error) {
      console.warn('IndividualPayroll table not found, returning empty results:', error)
      return NextResponse.json({
        payrolls: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0
        }
      })
    }
    
    // Get payroll records
    let payrolls = []
    try {
      payrolls = await prisma.individualPayroll.findMany({
        where,
        include: {
          loads: true,
          adjustments: {
            where: { status: { in: ['ACTIVE', 'APPROVED'] } }
          },
          paystub: {
            select: {
              id: true,
              status: true,
              generatedDate: true
            }
          }
        },
        orderBy: { weekStartDate: 'desc' },
        take: limit,
        skip: offset
      })
    } catch (error) {
      console.warn('Error fetching individual payrolls:', error)
      return NextResponse.json({
        payrolls: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0
        }
      })
    }
    
    return NextResponse.json({
      payrolls,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    })
    
  } catch (error) {
    console.error('Error fetching individual payrolls:', error)
    return NextResponse.json(
      { error: 'Failed to fetch payrolls' },
      { status: 500 }
    )
  }
}

// POST /api/payroll/individual - Create or update individual payroll
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      employeeId,
      weekStartDate,
      weekEndDate,
      payDate,
      includeLoads = true,
      recalculate = false,
      createdBy = 'web-api'
    } = body
    
    // Validate required fields
    if (!employeeId || !weekStartDate || !weekEndDate) {
      return NextResponse.json(
        { error: 'Employee ID, week start date, and week end date are required' },
        { status: 400 }
      )
    }
    
    // Get employee information
    const employee = await prisma.employee.findUnique({
      where: { id: parseInt(employeeId) },
      select: {
        id: true,
        name: true,
        status: true,
        paymentMethod: true,
        driverPercent: true,
        payPerMileRate: true
      }
    })
    
    if (!employee) {
      return NextResponse.json(
        { error: 'Employee not found' },
        { status: 404 }
      )
    }
    
    if (employee.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: 'Cannot create payroll for inactive employee' },
        { status: 400 }
      )
    }
    
    // Check if payroll already exists for this employee/week
    const existingPayroll = await prisma.individualPayroll.findUnique({
      where: {
        employeeId_weekStartDate: {
          employeeId: parseInt(employeeId),
          weekStartDate
        }
      },
      include: {
        loads: true,
        adjustments: true,
        paystub: true
      }
    })
    
    if (existingPayroll && !recalculate) {
      return NextResponse.json(
        { 
          error: 'Payroll already exists for this employee and week',
          existingPayroll
        },
        { status: 409 }
      )
    }
    
    if (existingPayroll && existingPayroll.isLocked) {
      return NextResponse.json(
        { error: 'Cannot modify locked payroll' },
        { status: 400 }
      )
    }
    
    // Get delivered loads for this employee and week
    let loads = []
    if (includeLoads) {
      loads = await prisma.load.findMany({
        where: {
          driverId: parseInt(employeeId),
          status: 'DELIVERED',
          deliveryDate: {
            gte: weekStartDate,
            lte: weekEndDate
          }
        },
        select: {
          id: true,
          loadNumber: true,
          grossAmount: true,
          driverRate: true,
          finalMiles: true,
          deliveryDate: true,
          paymentMethod: true,
          payPerMileRate: true
        }
      })
    }
    
    // Calculate payroll totals
    let totalLoads = loads.length
    let totalMiles = loads.reduce((sum, load) => sum + (load.finalMiles || 0), 0)
    let grossRevenue = loads.reduce((sum, load) => sum + (load.grossAmount || 0), 0)
    
    // Calculate base pay based on payment method
    let basePay = 0
    let basePayRate = 0
    const paymentMethod = employee.paymentMethod || 'PERCENTAGE'
    
    switch (paymentMethod) {
      case 'PERCENTAGE':
        basePayRate = employee.driverPercent || 0
        basePay = grossRevenue * (basePayRate / 100)
        break
      case 'PAY_PER_MILE':
        basePayRate = employee.payPerMileRate || 0
        basePay = totalMiles * basePayRate
        break
      case 'FLAT_RATE':
        basePay = loads.reduce((sum, load) => sum + (load.driverRate || 0), 0)
        break
    }
    
    // Create or update payroll record
    const payrollData = {
      employeeId: parseInt(employeeId),
      employeeName: employee.name,
      weekStartDate,
      weekEndDate,
      payDate,
      totalLoads,
      totalMiles,
      grossRevenue,
      paymentMethod,
      basePayRate,
      basePay,
      grossPay: basePay, // Will be updated with adjustments
      netPay: basePay,   // Will be updated with deductions
      status: 'CALCULATED',
      calculatedDate: todayISO(),
      calculatedBy: createdBy,
      createdDate: todayISO(),
      createdBy
    }
    
    let payroll
    if (existingPayroll) {
      // Update existing payroll
      payroll = await prisma.individualPayroll.update({
        where: { id: existingPayroll.id },
        data: {
          ...payrollData,
          modifiedDate: todayISO()
        }
      })
      
      // Clear existing loads
      await prisma.payrollLoad.deleteMany({
        where: { payrollId: existingPayroll.id }
      })
    } else {
      // Create new payroll
      payroll = await prisma.individualPayroll.create({
        data: payrollData
      })
    }
    
    // Create payroll loads
    for (const load of loads) {
      await prisma.payrollLoad.create({
        data: {
          payrollId: payroll.id,
          loadId: load.id,
          loadNumber: load.loadNumber,
          grossAmount: load.grossAmount,
          driverRate: load.driverRate,
          finalMiles: load.finalMiles,
          deliveryDate: load.deliveryDate,
          paymentMethod: load.paymentMethod || paymentMethod,
          payPerMileRate: load.payPerMileRate || employee.payPerMileRate || 0,
          driverPercent: employee.driverPercent || 0,
          isIncluded: true,
          createdDate: todayISO()
        }
      })
    }
    
    // Get the complete payroll record
    const completePayroll = await prisma.individualPayroll.findUnique({
      where: { id: payroll.id },
      include: {
        loads: true,
        adjustments: true,
        paystub: true
      }
    })
    
    console.log(`✅ ${existingPayroll ? 'Updated' : 'Created'} payroll for ${employee.name} (${weekStartDate} to ${weekEndDate})`)
    console.log(`   Total loads: ${totalLoads}, Miles: ${totalMiles}, Gross revenue: $${grossRevenue.toFixed(2)}`)
    console.log(`   Payment method: ${paymentMethod}, Base pay: $${basePay.toFixed(2)}`)
    
    return NextResponse.json(completePayroll, { status: existingPayroll ? 200 : 201 })
    
  } catch (error) {
    console.error('Error creating/updating individual payroll:', error)
    return NextResponse.json(
      { error: 'Failed to process payroll' },
      { status: 500 }
    )
  }
}
