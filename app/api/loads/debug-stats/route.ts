import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'

export async function GET(req: NextRequest) {
  try {
    // Get comprehensive database statistics for debugging
    
    // Total loads count
    const totalLoads = await prisma.load.count()
    
    // Count loads by status
    const loadsByStatusRaw = await prisma.load.groupBy({
      by: ['status'],
      _count: {
        status: true
      }
    })
    
    const loadsByStatus: Record<string, number> = {}
    loadsByStatusRaw.forEach(item => {
      loadsByStatus[item.status] = item._count.status
    })
    
    // Get date range of loads
    const dateRange = await prisma.load.findMany({
      select: {
        deliveryDate: true,
        createdDate: true
      },
      orderBy: [
        { deliveryDate: 'asc' },
        { createdDate: 'asc' }
      ]
    })
    
    const dates = dateRange
      .map(load => load.deliveryDate || load.createdDate)
      .filter(date => date !== null)
      .sort()
    
    const earliest = dates.length > 0 ? dates[0] : null
    const latest = dates.length > 0 ? dates[dates.length - 1] : null
    
    // Get additional statistics
    const [
      loadsWithDrivers,
      loadsWithoutDrivers,
      recentLoads,
      grossAmountStats
    ] = await Promise.all([
      prisma.load.count({
        where: {
          driverId: { gt: 0 }
        }
      }),
      prisma.load.count({
        where: {
          OR: [
            { driverId: 0 },
            { driverId: null }
          ]
        }
      }),
      prisma.load.count({
        where: {
          createdDate: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
          }
        }
      }),
      prisma.load.aggregate({
        _sum: {
          grossAmount: true
        },
        _avg: {
          grossAmount: true
        },
        _count: {
          grossAmount: true
        }
      })
    ])
    
    // Get sample of recent loads for inspection
    const sampleLoads = await prisma.load.findMany({
      take: 10,
      orderBy: { id: 'desc' },
      select: {
        id: true,
        loadNumber: true,
        customer: true,
        status: true,
        grossAmount: true,
        deliveryDate: true,
        createdDate: true,
        driverId: true,
        driverName: true
      }
    })
    
    const debugStats = {
      totalLoads,
      loadsByStatus,
      dateRange: {
        earliest,
        latest
      },
      additionalStats: {
        loadsWithDrivers,
        loadsWithoutDrivers,
        recentLoads, // Loads created in last 7 days
        totalGrossAmount: grossAmountStats._sum.grossAmount || 0,
        averageGrossAmount: grossAmountStats._avg.grossAmount || 0,
        loadsWithGrossAmount: grossAmountStats._count.grossAmount || 0
      },
      sampleLoads,
      databaseInfo: {
        timestamp: new Date().toISOString(),
        queryExecutionTime: Date.now()
      }
    }
    
    console.log('🔍 Debug Stats Generated:', {
      totalLoads,
      statusBreakdown: Object.keys(loadsByStatus).length,
      dateRange: earliest && latest ? `${earliest} to ${latest}` : 'No dates found'
    })
    
    return NextResponse.json(debugStats)
    
  } catch (error) {
    console.error('Error generating debug stats:', error)
    return NextResponse.json({
      error: 'Failed to generate debug statistics',
      details: error instanceof Error ? error.message : 'Unknown error',
      totalLoads: 0,
      loadsByStatus: {},
      dateRange: { earliest: null, latest: null },
      additionalStats: {
        loadsWithDrivers: 0,
        loadsWithoutDrivers: 0,
        recentLoads: 0,
        totalGrossAmount: 0,
        averageGrossAmount: 0,
        loadsWithGrossAmount: 0
      },
      sampleLoads: [],
      databaseInfo: {
        timestamp: new Date().toISOString(),
        queryExecutionTime: 0
      }
    }, { status: 500 })
  }
}
