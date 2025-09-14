import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { FuelSummary } from '@/lib/fuel-types'

// GET - Fetch fuel transaction summary statistics
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    // Build date filter if provided
    const where: any = {}
    if (startDate) {
      where.tranDate = { ...where.tranDate, gte: startDate }
    }
    if (endDate) {
      where.tranDate = { ...where.tranDate, lte: endDate }
    }

    // Get all transactions for summary
    const transactions = await prisma.fuelTransaction.findMany({
      where,
      orderBy: { tranDate: 'desc' }
    })

    const summary: FuelSummary = {
      totalTransactions: transactions.length,
      totalAmount: transactions.reduce((sum, tx) => sum + tx.amt, 0),
      totalQuantity: transactions.reduce((sum, tx) => sum + tx.qty, 0),
      totalSavings: transactions.reduce((sum, tx) => sum + tx.discAmt + tx.discCost, 0),
      averagePrice: 0,
      topDrivers: [],
      topLocations: [],
      fuelTypeBreakdown: []
    }

    // Calculate average price
    if (summary.totalQuantity > 0) {
      summary.averagePrice = summary.totalAmount / summary.totalQuantity
    }

    // Top drivers analysis
    const driverStats = new Map<string, { transactions: number, totalAmount: number }>()
    transactions.forEach(tx => {
      const existing = driverStats.get(tx.driverName) || { transactions: 0, totalAmount: 0 }
      existing.transactions++
      existing.totalAmount += tx.amt
      driverStats.set(tx.driverName, existing)
    })

    summary.topDrivers = Array.from(driverStats.entries())
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 10)

    // Top locations analysis
    const locationStats = new Map<string, { transactions: number, totalAmount: number }>()
    transactions.forEach(tx => {
      if (!tx.locationName) return
      const existing = locationStats.get(tx.locationName) || { transactions: 0, totalAmount: 0 }
      existing.transactions++
      existing.totalAmount += tx.amt
      locationStats.set(tx.locationName, existing)
    })

    summary.topLocations = Array.from(locationStats.entries())
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 10)

    // Fuel type breakdown
    const fuelTypeStats = new Map<string, { quantity: number, amount: number }>()
    transactions.forEach(tx => {
      const fuelType = tx.item || 'Unknown'
      const existing = fuelTypeStats.get(fuelType) || { quantity: 0, amount: 0 }
      existing.quantity += tx.qty
      existing.amount += tx.amt
      fuelTypeStats.set(fuelType, existing)
    })

    summary.fuelTypeBreakdown = Array.from(fuelTypeStats.entries())
      .map(([type, stats]) => ({ type, ...stats }))
      .sort((a, b) => b.amount - a.amount)

    console.log(`Generated fuel summary - ${summary.totalTransactions} transactions, $${summary.totalAmount.toFixed(2)} total`)
    return NextResponse.json(summary)
  } catch (error) {
    console.error('Error generating fuel summary:', error)
    return NextResponse.json({ error: 'Failed to generate fuel summary' }, { status: 500 })
  }
}
