import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { DEFAULT_FUEL_COLUMN_MAPPINGS } from '@/lib/fuel-types'
import { todayISO } from '@/utils/dates'

// Helper function to get field descriptions
function getFieldDescription(fieldName: string): string {
  const descriptions: { [key: string]: string } = {
    'Card Number': 'Fuel card number used for the transaction',
    'Transaction Date': 'Date when the fuel transaction occurred (REQUIRED)',
    'Transaction Time': 'Time when the fuel transaction occurred',
    'Invoice': 'Unique invoice or receipt number (REQUIRED)',
    'Unit': 'Truck unit number or identifier',
    'Driver Name': 'Full name of the driver who made the transaction (REQUIRED)',
    'Odometer': 'Vehicle odometer reading at time of fuel purchase',
    'Location Name': 'Name of the gas station or fuel location',
    'City': 'City where the fuel purchase was made',
    'State/Province': 'State or province where the fuel purchase was made',
    'Fees': 'Additional fees charged for the transaction',
    'Item': 'Type of fuel purchased (Diesel, Gasoline, etc.)',
    'Unit Price': 'Price per gallon or liter',
    'Discount PPU': 'Discount amount per unit',
    'Discount Cost': 'Total discount cost applied',
    'Quantity': 'Amount of fuel purchased in gallons or liters',
    'Discount Amount': 'Total discount amount received',
    'Discount Type': 'Type of discount applied (Fleet, Corporate, etc.)',
    'Amount': 'Total transaction amount',
    'DB': 'Database identifier or reference',
    'Currency': 'Currency used for the transaction (USD, CAD, etc.)'
  }
  return descriptions[fieldName] || `Column mapping for ${fieldName}`
}

// GET - Get fuel import configuration
export async function GET() {
  try {
    const config = await prisma.fuelImportConfig.findMany({
      where: { isActive: true },
      orderBy: { fieldName: 'asc' }
    })

    // If no config exists, create default configuration
    if (config.length === 0) {
      console.log('Creating default fuel import configuration')
      const defaultMappings = Object.entries(DEFAULT_FUEL_COLUMN_MAPPINGS).map(([fieldName, columnMapping]) => ({
        fieldName,
        columnMapping,
        isActive: true,
        isRequired: ['Invoice', 'Transaction Date', 'Driver Name'].includes(fieldName),
        description: getFieldDescription(fieldName),
        createdDate: todayISO(),
        modifiedDate: todayISO()
      }))

      try {
        await prisma.fuelImportConfig.createMany({
          data: defaultMappings
        })
      } catch (createError) {
        console.error('Error creating default config:', createError)
        // If creation fails, return the default mappings as objects
        const fallbackConfig = defaultMappings.map((mapping, index) => ({
          id: index + 1,
          ...mapping
        }))
        return NextResponse.json(fallbackConfig)
      }

      const newConfig = await prisma.fuelImportConfig.findMany({
        where: { isActive: true },
        orderBy: { fieldName: 'asc' }
      })

      console.log('Created default fuel import configuration')
      return NextResponse.json(newConfig)
    }

    return NextResponse.json(config)
  } catch (error) {
    console.error('Error fetching fuel import config:', error)
    return NextResponse.json({ error: 'Failed to fetch import configuration' }, { status: 500 })
  }
}

// POST - Update fuel import configuration
export async function POST(req: NextRequest) {
  try {
    const configurations = await req.json()
    
    if (!Array.isArray(configurations)) {
      return NextResponse.json({ error: 'Invalid configuration format' }, { status: 400 })
    }

    // Update each configuration
    const results = []
    for (const config of configurations) {
      if (!config.fieldName) {
        continue
      }

      const updated = await prisma.fuelImportConfig.upsert({
        where: { fieldName: config.fieldName },
        update: {
          columnMapping: (config.columnMapping || '').trim(),
          isActive: config.isActive !== false,
          isRequired: config.isRequired === true,
          description: config.description || null,
          modifiedDate: todayISO()
        },
        create: {
          fieldName: config.fieldName,
          columnMapping: (config.columnMapping || '').trim(),
          isActive: config.isActive !== false,
          isRequired: config.isRequired === true,
          description: config.description || getFieldDescription(config.fieldName),
          createdDate: todayISO(),
          modifiedDate: todayISO()
        }
      })

      results.push(updated)
    }

    console.log(`Updated ${results.length} fuel import configurations`)
    return NextResponse.json(results)
  } catch (error) {
    console.error('Error updating fuel import config:', error)
    return NextResponse.json({ error: 'Failed to update import configuration' }, { status: 500 })
  }
}

// PUT - Reset to default configuration
export async function PUT() {
  try {
    // Delete existing configuration
    await prisma.fuelImportConfig.deleteMany({})

    // Create default configuration
    const defaultMappings = Object.entries(DEFAULT_FUEL_COLUMN_MAPPINGS).map(([fieldName, columnMapping]) => ({
      fieldName,
      columnMapping,
      isActive: true,
      isRequired: ['Invoice', 'Transaction Date', 'Driver Name'].includes(fieldName),
      description: getFieldDescription(fieldName),
      createdDate: todayISO(),
      modifiedDate: todayISO()
    }))

    await prisma.fuelImportConfig.createMany({
      data: defaultMappings
    })

    const newConfig = await prisma.fuelImportConfig.findMany({
      where: { isActive: true },
      orderBy: { fieldName: 'asc' }
    })

    console.log('Reset fuel import configuration to defaults')
    return NextResponse.json(newConfig)
  } catch (error) {
    console.error('Error resetting fuel import config:', error)
    return NextResponse.json({ error: 'Failed to reset import configuration' }, { status: 500 })
  }
}
