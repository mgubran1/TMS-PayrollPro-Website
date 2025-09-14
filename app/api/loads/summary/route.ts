import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { LoadStatus, LoadSummary } from '@/lib/loads-types'

// GET /api/loads/summary - Get load statistics and summary data
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    
    // Date range for filtering
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const period = searchParams.get('period') || '30' // days
    
    // Build date filter
    const dateFilter: any = {}
    if (dateFrom && dateTo) {
      dateFilter.deliveryDate = {
        gte: dateFrom,
        lte: dateTo
      }
    } else {
      // Default to last 30 days
      const daysAgo = parseInt(period)
      const fromDate = new Date()
      fromDate.setDate(fromDate.getDate() - daysAgo)
      dateFilter.deliveryDate = {
        gte: fromDate.toISOString().split('T')[0]
      }
    }
    
    // Get basic counts and totals
    const [
      totalLoads,
      totalGrossAmount,
      totalDriverPay,
      statusBreakdown,
      lateLoads,
      activeDrivers,
      recentLoads
    ] = await Promise.all([
      // Total loads in period
      prisma.load.count({
        where: dateFilter
      }),
      
      // Total gross amount
      prisma.load.aggregate({
        where: dateFilter,
        _sum: { grossAmount: true }
      }),
      
      // Total driver pay
      prisma.load.aggregate({
        where: dateFilter,
        _sum: { driverRate: true }
      }),
      
      // Status breakdown
      prisma.load.groupBy({
        by: ['status'],
        where: dateFilter,
        _count: { status: true }
      }),
      
      // Late loads count
      prisma.load.count({
        where: {
          ...dateFilter,
          status: { in: ['PICKUP_LATE', 'DELIVERY_LATE'] }
        }
      }),
      
      // Count of active drivers (with loads in period)
      prisma.load.findMany({
        where: {
          ...dateFilter,
          driverId: { gt: 0 }
        },
        select: { driverId: true },
        distinct: ['driverId']
      }),
      
      // Recent loads for activity feed
      prisma.load.findMany({
        where: dateFilter,
        select: {
          id: true,
          loadNumber: true,
          status: true,
          customer: true,
          grossAmount: true,
          deliveryDate: true,
          driverName: true,
          modifiedDate: true
        },
        orderBy: { modifiedDate: 'desc' },
        take: 10
      })
    ])
    
    // Get revenue by month for trend analysis
    const monthlyRevenue = await prisma.$queryRaw`
      SELECT 
        strftime('%Y-%m', deliveryDate) as month,
        SUM(grossAmount) as revenue,
        COUNT(*) as loadCount
      FROM Load 
      WHERE deliveryDate IS NOT NULL 
        AND deliveryDate >= date('now', '-12 months')
        ${dateFrom && dateTo ? 
          `AND deliveryDate >= '${dateFrom}' AND deliveryDate <= '${dateTo}'` : 
          ''}
      GROUP BY strftime('%Y-%m', deliveryDate)
      ORDER BY month DESC
      LIMIT 12
    ` as { month: string, revenue: number, loadCount: number }[]
    
    // Get top customers by load count
    const topCustomers = await prisma.load.groupBy({
      by: ['customer'],
      where: dateFilter,
      _count: { customer: true },
      _sum: { grossAmount: true },
      orderBy: { _count: { customer: 'desc' } },
      take: 10
    })
    
    // Get top drivers by load count and earnings
    const topDrivers = await prisma.load.groupBy({
      by: ['driverName'],
      where: {
        ...dateFilter,
        driverName: { not: null }
      },
      _count: { driverName: true },
      _sum: { driverRate: true },
      orderBy: { _count: { driverName: 'desc' } },
      take: 10
    })
    
    // Calculate performance metrics
    const deliveredLoads = await prisma.load.findMany({
      where: {
        ...dateFilter,
        status: { in: ['DELIVERED', 'PAID'] },
        deliveryDate: { not: null }
      },
      select: {
        deliveryDate: true,
        createdDate: true,
        status: true
      }
    })
    
    // Calculate average delivery time
    let averageDeliveryDays = 0
    let onTimeDeliveryRate = 0
    
    if (deliveredLoads.length > 0) {
      const deliveryTimes = deliveredLoads
        .filter(load => load.createdDate && load.deliveryDate)
        .map(load => {
          const created = new Date(load.createdDate!)
          const delivered = new Date(load.deliveryDate!)
          return Math.abs(delivered.getTime() - created.getTime()) / (1000 * 3600 * 24)
        })
      
      if (deliveryTimes.length > 0) {
        averageDeliveryDays = deliveryTimes.reduce((a, b) => a + b, 0) / deliveryTimes.length
      }
      
      // Calculate on-time delivery rate (not late)
      const onTimeCount = deliveredLoads.filter(load => 
        !load.status.includes('LATE')
      ).length
      onTimeDeliveryRate = (onTimeCount / deliveredLoads.length) * 100
    }
    
    // Build summary response
    const summary: LoadSummary = {
      totalLoads,
      totalGrossAmount: totalGrossAmount._sum.grossAmount || 0,
      totalDriverPay: totalDriverPay._sum.driverRate || 0,
      statusBreakdown: statusBreakdown.reduce((acc, item) => {
        acc[item.status as LoadStatus] = item._count.status
        return acc
      }, {} as Record<LoadStatus, number>),
      lateLoadsCount: lateLoads,
      activeDriversCount: activeDrivers.length,
      revenueByMonth: monthlyRevenue.map(item => ({
        month: item.month,
        revenue: Number(item.revenue) || 0
      }))
    }
    
    // Additional statistics
    const stats = {
      averageGrossAmount: summary.totalLoads > 0 ? summary.totalGrossAmount / summary.totalLoads : 0,
      averageDriverRate: summary.totalLoads > 0 ? summary.totalDriverPay / summary.totalLoads : 0,
      averageDeliveryDays: Math.round(averageDeliveryDays * 10) / 10,
      onTimeDeliveryRate: Math.round(onTimeDeliveryRate * 10) / 10,
      profitMargin: summary.totalGrossAmount > 0 ? 
        Math.round(((summary.totalGrossAmount - summary.totalDriverPay) / summary.totalGrossAmount) * 100 * 10) / 10 : 0,
      
      mostActiveCustomers: topCustomers.map(item => ({
        customer: item.customer,
        loadCount: item._count.customer,
        totalRevenue: item._sum.grossAmount || 0
      })),
      
      topDrivers: topDrivers
        .filter(item => item.driverName)
        .map(item => ({
          driverName: item.driverName!,
          loadCount: item._count.driverName,
          totalEarnings: item._sum.driverRate || 0
        })),
      
      recentActivity: recentLoads
    }
    
    console.log(`Generated load summary: ${summary.totalLoads} loads, $${summary.totalGrossAmount} revenue`)
    
    return NextResponse.json({
      summary,
      stats,
      period: {
        from: dateFrom || new Date(Date.now() - parseInt(period) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        to: dateTo || new Date().toISOString().split('T')[0],
        days: parseInt(period)
      }
    })
    
  } catch (error) {
    console.error('Error generating load summary:', error)
    return NextResponse.json(
      { error: 'Failed to generate load summary' },
      { status: 500 }
    )
  }
}

