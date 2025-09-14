import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'
import { getCurrentWeekRange, getCurrentBiWeeklyRange } from '../../../../lib/payroll-utils'

// GET /api/debug/employee-load-payroll - Debug Employee->Load->Payroll integration
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const employeeId = searchParams.get('employeeId')
    
    console.log('🔍 DEBUG: Employee-Load-Payroll Integration Analysis')
    
    // Get all employees with basic info
    const employees = await prisma.employee.findMany({
      select: {
        id: true,
        name: true,
        status: true,
        paymentMethod: true,
        driverPercent: true,
        payPerMileRate: true
      },
      orderBy: { name: 'asc' }
    })
    
    console.log(`📊 Found ${employees.length} employees in database`)
    
    // Get current week and bi-weekly ranges
    const currentWeek = getCurrentWeekRange()
    const currentBiWeekly = getCurrentBiWeeklyRange()
    
    console.log(`📅 Current Week: ${currentWeek.startDate} to ${currentWeek.endDate}`)
    console.log(`📅 Current Bi-Weekly: ${currentBiWeekly.startDate} to ${currentBiWeekly.endDate}`)
    
    // Get all loads with status breakdown
    const allLoads = await prisma.load.findMany({
      select: {
        id: true,
        loadNumber: true,
        driverId: true,
        driverName: true,
        status: true,
        deliveryDate: true,
        grossAmount: true,
        driverRate: true,
        paymentMethod: true,
        finalMiles: true
      },
      orderBy: { deliveryDate: 'desc' }
    })
    
    console.log(`📦 Found ${allLoads.length} total loads in database`)
    
    // Status breakdown
    const statusBreakdown = allLoads.reduce((acc, load) => {
      acc[load.status] = (acc[load.status] || 0) + 1
      return acc
    }, {} as Record<string, number>)
    
    console.log('📊 Load Status Breakdown:', statusBreakdown)
    
    // Get loads in current week
    const currentWeekLoads = allLoads.filter(load => 
      load.deliveryDate && 
      load.deliveryDate >= currentWeek.startDate && 
      load.deliveryDate <= currentWeek.endDate
    )
    
    console.log(`📦 Loads in current week: ${currentWeekLoads.length}`)
    
    // Get delivered loads in current week
    const deliveredCurrentWeekLoads = currentWeekLoads.filter(load => 
      load.status === 'DELIVERED'
    )
    
    console.log(`✅ DELIVERED loads in current week: ${deliveredCurrentWeekLoads.length}`)
    
    // Analyze employee-load relationships
    const employeeAnalysis = []
    
    for (const employee of employees) {
      const employeeLoads = allLoads.filter(load => load.driverId === employee.id)
      const employeeDeliveredLoads = employeeLoads.filter(load => load.status === 'DELIVERED')
      const employeeCurrentWeekLoads = currentWeekLoads.filter(load => load.driverId === employee.id)
      const employeeDeliveredCurrentWeekLoads = deliveredCurrentWeekLoads.filter(load => load.driverId === employee.id)
      
      const analysis = {
        employee: {
          id: employee.id,
          name: employee.name,
          status: employee.status,
          paymentMethod: employee.paymentMethod,
          driverPercent: employee.driverPercent,
          payPerMileRate: employee.payPerMileRate
        },
        loads: {
          total: employeeLoads.length,
          delivered: employeeDeliveredLoads.length,
          currentWeekAll: employeeCurrentWeekLoads.length,
          currentWeekDelivered: employeeDeliveredCurrentWeekLoads.length
        },
        recentLoads: employeeLoads.slice(0, 5).map(load => ({
          id: load.id,
          loadNumber: load.loadNumber,
          status: load.status,
          deliveryDate: load.deliveryDate,
          grossAmount: load.grossAmount,
          driverRate: load.driverRate
        })),
        payrollEligible: employee.status === 'ACTIVE' && employeeDeliveredCurrentWeekLoads.length > 0,
        issues: []
      }
      
      // Identify potential issues
      if (employee.status !== 'ACTIVE') {
        analysis.issues.push('Employee status is not ACTIVE')
      }
      
      if (!employee.paymentMethod) {
        analysis.issues.push('No payment method configured')
      }
      
      if (employee.paymentMethod === 'PERCENTAGE' && !employee.driverPercent) {
        analysis.issues.push('PERCENTAGE method but no driver percentage set')
      }
      
      if (employee.paymentMethod === 'PAY_PER_MILE' && !employee.payPerMileRate) {
        analysis.issues.push('PAY_PER_MILE method but no per-mile rate set')
      }
      
      if (employeeDeliveredLoads.length > 0) {
        const loadsWithoutDriverRate = employeeDeliveredLoads.filter(load => !load.driverRate || load.driverRate <= 0)
        if (loadsWithoutDriverRate.length > 0) {
          analysis.issues.push(`${loadsWithoutDriverRate.length} delivered loads have no driver rate calculated`)
        }
      }
      
      employeeAnalysis.push(analysis)
      
      // Log detailed info for specific employee if requested
      if (employeeId && employee.id === parseInt(employeeId)) {
        console.log(`🔍 DETAILED ANALYSIS for Employee ${employee.name} (ID: ${employee.id})`)
        console.log('Employee Config:', employee)
        console.log('Load Summary:', analysis.loads)
        console.log('Recent Loads:', analysis.recentLoads)
        console.log('Issues:', analysis.issues)
      }
    }
    
    // Get payroll periods for context
    const recentPayrollPeriods = await prisma.payrollPeriod.findMany({
      take: 5,
      orderBy: { startDate: 'desc' },
      include: {
        paystubs: {
          select: {
            id: true,
            employeeId: true,
            employeeName: true,
            grossPay: true,
            netPay: true,
            totalLoads: true,
            status: true
          }
        }
      }
    })
    
    console.log(`💰 Found ${recentPayrollPeriods.length} recent payroll periods`)
    
    // Summary statistics
    const summary = {
      totalEmployees: employees.length,
      activeEmployees: employees.filter(e => e.status === 'ACTIVE').length,
      totalLoads: allLoads.length,
      deliveredLoads: allLoads.filter(l => l.status === 'DELIVERED').length,
      currentWeekLoads: currentWeekLoads.length,
      currentWeekDeliveredLoads: deliveredCurrentWeekLoads.length,
      employeesWithCurrentWeekWork: employeeAnalysis.filter(a => a.loads.currentWeekDelivered > 0).length,
      payrollEligibleEmployees: employeeAnalysis.filter(a => a.payrollEligible).length,
      employeesWithIssues: employeeAnalysis.filter(a => a.issues.length > 0).length
    }
    
    console.log('📊 SUMMARY:', summary)
    
    return NextResponse.json({
      summary,
      dateRanges: {
        currentWeek,
        currentBiWeekly
      },
      statusBreakdown,
      employees: employeeAnalysis,
      recentPayrollPeriods: recentPayrollPeriods.map(period => ({
        id: period.id,
        periodName: period.periodName,
        startDate: period.startDate,
        endDate: period.endDate,
        status: period.status,
        employeeCount: period.employeeCount,
        totalGrossPay: period.totalGrossPay,
        paystubCount: period.paystubs.length
      })),
      debugInfo: {
        timestamp: new Date().toISOString(),
        queryParameters: {
          employeeId: employeeId ? parseInt(employeeId) : null
        }
      }
    })
    
  } catch (error) {
    console.error('❌ DEBUG API Error:', error)
    return NextResponse.json(
      { error: 'Debug analysis failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
