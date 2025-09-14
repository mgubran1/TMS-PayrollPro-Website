import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { FuelTransaction } from '@/lib/fuel-types'
import { linkFuelTransactionToEmployee } from '@/lib/fuel-types'
import { todayISO } from '@/utils/dates'

// GET - Fetch all fuel transactions or filter by query params
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate') 
    const driverName = searchParams.get('driverName')
    const unit = searchParams.get('unit')
    const item = searchParams.get('item')
    const locationName = searchParams.get('locationName')

    // Build dynamic query
    const where: any = {}

    if (startDate) {
      where.tranDate = { ...where.tranDate, gte: startDate }
    }
    if (endDate) {
      where.tranDate = { ...where.tranDate, lte: endDate }
    }
    if (driverName) {
      where.driverName = { contains: driverName }
    }
    if (unit) {
      where.unit = { contains: unit }
    }
    if (item) {
      where.item = { contains: item }
    }
    if (locationName) {
      where.locationName = { contains: locationName }
    }

    const transactions = await prisma.fuelTransaction.findMany({
      where,
      include: {
        attachments: true
      },
      orderBy: [
        { tranDate: 'desc' },
        { tranTime: 'desc' }
      ]
    })

    // Link to employees for enhanced data
    const employees = await prisma.employee.findMany()
    const enhancedTransactions = transactions.map(tx => 
      linkFuelTransactionToEmployee(tx as FuelTransaction, employees)
    )

    console.log(`Retrieved ${transactions.length} fuel transactions`)
    return NextResponse.json(enhancedTransactions)
  } catch (error) {
    console.error('Error fetching fuel transactions:', error)
    return NextResponse.json({ error: 'Failed to fetch fuel transactions' }, { status: 500 })
  }
}

// POST - Create new fuel transaction
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<FuelTransaction>
    
    // Validate required fields
    if (!body.invoice || body.invoice.trim() === '') {
      return NextResponse.json({ error: 'Invoice number is required' }, { status: 400 })
    }
    if (!body.driverName || body.driverName.trim() === '') {
      return NextResponse.json({ error: 'Driver name is required' }, { status: 400 })
    }
    if (!body.tranDate || body.tranDate.trim() === '') {
      return NextResponse.json({ error: 'Transaction date is required' }, { status: 400 })
    }

    // Link to employee if possible
    const employees = await prisma.employee.findMany()
    const linkedTransaction = linkFuelTransactionToEmployee(body as FuelTransaction, employees)

    const transaction = await prisma.fuelTransaction.create({
      data: {
        cardNumber: body.cardNumber?.trim() || null,
        tranDate: body.tranDate.trim(),
        tranTime: body.tranTime?.trim() || null,
        invoice: body.invoice.trim(),
        unit: body.unit?.trim() || null,
        driverName: body.driverName.trim(),
        odometer: body.odometer?.trim() || null,
        locationName: body.locationName?.trim() || null,
        city: body.city?.trim() || null,
        stateProv: body.stateProv?.trim() || null,
        fees: body.fees || 0,
        item: body.item?.trim() || null,
        unitPrice: body.unitPrice || 0,
        discPPU: body.discPPU || 0,
        discCost: body.discCost || 0,
        qty: body.qty || 0,
        discAmt: body.discAmt || 0,
        discType: body.discType?.trim() || null,
        amt: body.amt || 0,
        db: body.db?.trim() || null,
        currency: body.currency || 'USD',
        employeeId: linkedTransaction.employeeId,
        createdDate: todayISO(),
        modifiedDate: todayISO(),
        modifiedBy: 'web-api'
      },
      include: {
        attachments: true
      }
    })

    console.log(`Created fuel transaction - Invoice: ${transaction.invoice}, Driver: ${transaction.driverName}`)
    return NextResponse.json(linkFuelTransactionToEmployee(transaction as FuelTransaction, employees), { status: 201 })
  } catch (error: any) {
    console.error('Error creating fuel transaction:', error)
    
    // Handle unique constraint violation (duplicate)
    if (error.code === 'P2002' && error.meta?.target?.includes('unique_fuel_transaction')) {
      return NextResponse.json({ 
        error: 'Duplicate transaction detected. A transaction with the same invoice, date, location, and amount already exists.' 
      }, { status: 409 })
    }
    
    return NextResponse.json({ error: 'Failed to create fuel transaction' }, { status: 500 })
  }
}

// PUT - Update existing fuel transaction
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as FuelTransaction
    
    // Validate required fields
    if (!body.id) {
      return NextResponse.json({ error: 'Transaction ID is required' }, { status: 400 })
    }
    if (!body.invoice || body.invoice.trim() === '') {
      return NextResponse.json({ error: 'Invoice number is required' }, { status: 400 })
    }
    if (!body.driverName || body.driverName.trim() === '') {
      return NextResponse.json({ error: 'Driver name is required' }, { status: 400 })
    }

    // Check if transaction exists
    const existingTransaction = await prisma.fuelTransaction.findUnique({ where: { id: body.id } })
    if (!existingTransaction) {
      return NextResponse.json({ error: 'Fuel transaction not found' }, { status: 404 })
    }

    // Link to employee if possible
    const employees = await prisma.employee.findMany()
    const linkedTransaction = linkFuelTransactionToEmployee(body, employees)

    const transaction = await prisma.fuelTransaction.update({
      where: { id: body.id },
      data: {
        cardNumber: body.cardNumber?.trim() || null,
        tranDate: body.tranDate.trim(),
        tranTime: body.tranTime?.trim() || null,
        invoice: body.invoice.trim(),
        unit: body.unit?.trim() || null,
        driverName: body.driverName.trim(),
        odometer: body.odometer?.trim() || null,
        locationName: body.locationName?.trim() || null,
        city: body.city?.trim() || null,
        stateProv: body.stateProv?.trim() || null,
        fees: body.fees || 0,
        item: body.item?.trim() || null,
        unitPrice: body.unitPrice || 0,
        discPPU: body.discPPU || 0,
        discCost: body.discCost || 0,
        qty: body.qty || 0,
        discAmt: body.discAmt || 0,
        discType: body.discType?.trim() || null,
        amt: body.amt || 0,
        db: body.db?.trim() || null,
        currency: body.currency || 'USD',
        employeeId: linkedTransaction.employeeId,
        modifiedDate: todayISO(),
        modifiedBy: 'web-api'
      },
      include: {
        attachments: true
      }
    })

    console.log(`Updated fuel transaction - ID: ${transaction.id}, Invoice: ${transaction.invoice}`)
    return NextResponse.json(linkFuelTransactionToEmployee(transaction as FuelTransaction, employees))
  } catch (error: any) {
    console.error('Error updating fuel transaction:', error)
    
    // Handle unique constraint violation (duplicate)
    if (error.code === 'P2002' && error.meta?.target?.includes('unique_fuel_transaction')) {
      return NextResponse.json({ 
        error: 'Duplicate transaction detected. A transaction with the same invoice, date, location, and amount already exists.' 
      }, { status: 409 })
    }
    
    return NextResponse.json({ error: 'Failed to update fuel transaction' }, { status: 500 })
  }
}

// DELETE - Delete fuel transaction
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = Number(searchParams.get('id'))

    if (!id) {
      return NextResponse.json({ error: 'Transaction ID is required' }, { status: 400 })
    }

    // Check if transaction exists
    const existingTransaction = await prisma.fuelTransaction.findUnique({ where: { id } })
    if (!existingTransaction) {
      return NextResponse.json({ error: 'Fuel transaction not found' }, { status: 404 })
    }

    // Use transaction to delete attachments first, then transaction
    await prisma.$transaction(async (tx) => {
      // Delete related attachments
      await tx.fuelAttachment.deleteMany({
        where: { fuelTransactionId: id }
      })
      
      // Delete the transaction
      await tx.fuelTransaction.delete({
        where: { id }
      })
    })

    console.log(`Deleted fuel transaction with ID: ${id}`)
    return NextResponse.json({ message: 'Fuel transaction deleted successfully' })
  } catch (error) {
    console.error('Error deleting fuel transaction:', error)
    return NextResponse.json({ error: 'Failed to delete fuel transaction' }, { status: 500 })
  }
}
