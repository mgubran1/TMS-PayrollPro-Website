import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { FuelTransaction, FuelImportResult } from '@/lib/fuel-types'
import { linkFuelTransactionToEmployee, DEFAULT_FUEL_COLUMN_MAPPINGS } from '@/lib/fuel-types'
import { todayISO } from '@/utils/dates'

// Get required fields from configuration
async function getRequiredFields(): Promise<string[]> {
  try {
    const configs = await prisma.fuelImportConfig.findMany({
      where: { isRequired: true, isActive: true }
    })
    return configs.map(c => c.fieldName)
  } catch (error) {
    console.error('Error getting required fields:', error)
    // Fallback to default required fields
    return ['Invoice', 'Transaction Date', 'Driver Name']
  }
}

// POST - Import fuel transactions from CSV data
export async function POST(req: NextRequest) {
  try {
    const { csvData, columnMappings } = await req.json()
    
    if (!csvData || !Array.isArray(csvData)) {
      return NextResponse.json({ error: 'Invalid CSV data format' }, { status: 400 })
    }

    const mappings = columnMappings || DEFAULT_FUEL_COLUMN_MAPPINGS
    const result: FuelImportResult = {
      total: csvData.length,
      imported: 0,
      skipped: 0,
      errors: 0,
      errorMessages: []
    }

    // Get required fields and employees for linking
    const [requiredFields, employees] = await Promise.all([
      getRequiredFields(),
      prisma.employee.findMany()
    ])
    
    for (let i = 0; i < csvData.length; i++) {
      const row = csvData[i]
      
      try {
        // Map CSV row to fuel transaction using column mappings
        const transaction: Partial<FuelTransaction> = {
          cardNumber: getValueFromRow(row, mappings, 'Card Number'),
          tranDate: getValueFromRow(row, mappings, 'Transaction Date'),
          tranTime: getValueFromRow(row, mappings, 'Transaction Time'),
          invoice: getValueFromRow(row, mappings, 'Invoice'),
          unit: getValueFromRow(row, mappings, 'Unit'),
          driverName: getValueFromRow(row, mappings, 'Driver Name'),
          odometer: getValueFromRow(row, mappings, 'Odometer'),
          locationName: getValueFromRow(row, mappings, 'Location Name'),
          city: getValueFromRow(row, mappings, 'City'),
          stateProv: getValueFromRow(row, mappings, 'State/Province'),
          fees: parseFloat(getValueFromRow(row, mappings, 'Fees')) || 0,
          item: getValueFromRow(row, mappings, 'Item'),
          unitPrice: parseFloat(getValueFromRow(row, mappings, 'Unit Price')) || 0,
          discPPU: parseFloat(getValueFromRow(row, mappings, 'Discount PPU')) || 0,
          discCost: parseFloat(getValueFromRow(row, mappings, 'Discount Cost')) || 0,
          qty: parseFloat(getValueFromRow(row, mappings, 'Quantity')) || 0,
          discAmt: parseFloat(getValueFromRow(row, mappings, 'Discount Amount')) || 0,
          discType: getValueFromRow(row, mappings, 'Discount Type'),
          amt: parseFloat(getValueFromRow(row, mappings, 'Amount')) || 0,
          db: getValueFromRow(row, mappings, 'DB'),
          currency: getValueFromRow(row, mappings, 'Currency') || 'USD',
        }

        // Validate required fields based on configuration
        const missingFields = []
        for (const fieldName of requiredFields) {
          let fieldValue = null
          switch (fieldName) {
            case 'Invoice': fieldValue = transaction.invoice; break
            case 'Driver Name': fieldValue = transaction.driverName; break
            case 'Transaction Date': fieldValue = transaction.tranDate; break
            case 'Amount': fieldValue = transaction.amt; break
            case 'Quantity': fieldValue = transaction.qty; break
            case 'Unit Price': fieldValue = transaction.unitPrice; break
            default: break
          }
          
          if (!fieldValue || (typeof fieldValue === 'string' && !fieldValue.trim())) {
            missingFields.push(fieldName)
          }
        }
        
        if (missingFields.length > 0) {
          result.errors++
          result.errorMessages.push(`Row ${i + 2}: Missing required fields: ${missingFields.join(', ')}`)
          continue
        }

        // Check for duplicates
        const existingTransaction = await prisma.fuelTransaction.findFirst({
          where: {
            invoice: transaction.invoice,
            tranDate: transaction.tranDate,
            locationName: transaction.locationName || '',
            amt: transaction.amt
          }
        })

        if (existingTransaction) {
          result.skipped++
          continue
        }

        // Link to employee
        const linkedTransaction = linkFuelTransactionToEmployee(transaction as FuelTransaction, employees)

        // Create transaction
        await prisma.fuelTransaction.create({
          data: {
            cardNumber: transaction.cardNumber?.trim() || null,
            tranDate: transaction.tranDate.trim(),
            tranTime: transaction.tranTime?.trim() || null,
            invoice: transaction.invoice.trim(),
            unit: transaction.unit?.trim() || null,
            driverName: transaction.driverName.trim(),
            odometer: transaction.odometer?.trim() || null,
            locationName: transaction.locationName?.trim() || null,
            city: transaction.city?.trim() || null,
            stateProv: transaction.stateProv?.trim() || null,
            fees: transaction.fees,
            item: transaction.item?.trim() || null,
            unitPrice: transaction.unitPrice,
            discPPU: transaction.discPPU,
            discCost: transaction.discCost,
            qty: transaction.qty,
            discAmt: transaction.discAmt,
            discType: transaction.discType?.trim() || null,
            amt: transaction.amt,
            db: transaction.db?.trim() || null,
            currency: transaction.currency,
            employeeId: linkedTransaction.employeeId,
            createdDate: todayISO(),
            modifiedDate: todayISO(),
            modifiedBy: 'import-api'
          }
        })

        result.imported++
      } catch (error: any) {
        result.errors++
        result.errorMessages.push(`Row ${i + 2}: ${error.message}`)
        console.error(`Error processing row ${i + 2}:`, error)
      }
    }

    console.log(`Import completed - Total: ${result.total}, Imported: ${result.imported}, Skipped: ${result.skipped}, Errors: ${result.errors}`)
    return NextResponse.json(result)
  } catch (error) {
    console.error('Error importing fuel transactions:', error)
    return NextResponse.json({ error: 'Failed to import fuel transactions' }, { status: 500 })
  }
}

// Helper function to get value from CSV row using column mappings
function getValueFromRow(row: any, mappings: any, fieldName: string): string {
  const columnHeader = mappings[fieldName]
  if (!columnHeader) return ''
  
  // Try exact match first
  if (row[columnHeader] !== undefined) {
    return String(row[columnHeader]).trim()
  }
  
  // Try case-insensitive match
  const lowerHeader = columnHeader.toLowerCase()
  for (const [key, value] of Object.entries(row)) {
    if (key.toLowerCase() === lowerHeader) {
      return String(value).trim()
    }
  }
  
  return ''
}
