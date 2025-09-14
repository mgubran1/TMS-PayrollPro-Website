import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Trailer } from '@/lib/types'
import { todayISO } from '@/utils/dates'

interface TrailerImportResult {
  total: number
  imported: number
  skipped: number
  errors: number
  errorMessages: string[]
}

// POST - Import trailers from CSV data
export async function POST(req: NextRequest) {
  try {
    const { csvData } = await req.json()
    
    if (!csvData || !Array.isArray(csvData)) {
      return NextResponse.json({ error: 'Invalid CSV data format' }, { status: 400 })
    }

    const result: TrailerImportResult = {
      total: csvData.length,
      imported: 0,
      skipped: 0,
      errors: 0,
      errorMessages: []
    }

    // Get existing trailers to check for duplicates
    const existingTrailers = await prisma.trailer.findMany({
      select: { trailerNumber: true, id: true }
    })
    const existingNumbers = new Set(existingTrailers.map(t => t.trailerNumber.toLowerCase()))

    for (let i = 0; i < csvData.length; i++) {
      const row = csvData[i]
      const rowNum = i + 2 // Account for header row in error messages
      
      try {
        // Map CSV columns to trailer fields with various possible column names
        const trailerData: Partial<Trailer> = {
          trailerNumber: row['Trailer Number'] || row['TrailerNumber'] || row['Number'] || '',
          vin: row['VIN'] || row['Vin'] || '',
          make: row['Make'] || '',
          model: row['Model'] || '',
          year: parseNumber(row['Year']),
          type: row['Type'] || '',
          status: validateStatus(row['Status'] || 'ACTIVE'),
          licensePlate: row['License Plate'] || row['LicensePlate'] || row['Plate'] || '',
          registrationExpiryDate: parseDate(row['Registration Expiry'] || row['RegistrationExpiry'] || row['RegExpiry']),
          currentLocation: row['Current Location'] || row['Location'] || '',
          
          // Technical Specifications
          length: parseNumber(row['Length']),
          width: parseNumber(row['Width']),
          height: parseNumber(row['Height']),
          capacity: parseNumber(row['Capacity']),
          maxWeight: parseNumber(row['Max Weight'] || row['MaxWeight']),
          emptyWeight: parseNumber(row['Empty Weight'] || row['EmptyWeight']),
          axleCount: parseNumber(row['Axle Count'] || row['AxleCount'], 2),
          suspensionType: row['Suspension Type'] || row['SuspensionType'] || '',
          hasThermalUnit: parseBoolean(row['Has Thermal Unit'] || row['Thermal'] || row['Refrigerated']),
          thermalUnitDetails: row['Thermal Unit Details'] || row['ThermalDetails'] || '',
          
          // Financial and Ownership
          ownershipType: validateOwnership(row['Ownership Type'] || row['Ownership'] || 'Company'),
          purchasePrice: parseNumber(row['Purchase Price'] || row['PurchasePrice']),
          purchaseDate: parseDate(row['Purchase Date'] || row['PurchaseDate']),
          currentValue: parseNumber(row['Current Value'] || row['CurrentValue']),
          monthlyLeaseCost: parseNumber(row['Monthly Lease Cost'] || row['LeaseCost']),
          leaseDetails: row['Lease Details'] || row['LeaseDetails'] || '',
          leaseAgreementExpiryDate: parseDate(row['Lease Expiry'] || row['LeaseExpiry']),
          insurancePolicyNumber: row['Insurance Policy'] || row['Policy'] || '',
          insuranceExpiryDate: parseDate(row['Insurance Expiry'] || row['InsuranceExpiry']),
          
          // Maintenance
          odometerReading: parseNumber(row['Odometer'] || row['Miles']),
          lastInspectionDate: parseDate(row['Last Inspection'] || row['LastInspection']),
          nextInspectionDueDate: parseDate(row['Next Inspection'] || row['NextInspection']),
          lastServiceDate: parseDate(row['Last Service'] || row['LastService']),
          nextServiceDueDate: parseDate(row['Next Service'] || row['NextService']),
          currentCondition: validateCondition(row['Condition'] || 'Good'),
          maintenanceNotes: row['Maintenance Notes'] || row['Notes'] || '',
          
          // Usage and Assignment
          assignedDriver: row['Assigned Driver'] || row['Driver'] || '',
          assignedTruck: row['Assigned Truck'] || row['Truck'] || '',
          currentJobId: row['Job ID'] || row['JobID'] || '',
          
          // Tracking
          lastUpdated: todayISO(),
          updatedBy: 'import',
          notes: row['General Notes'] || row['Comments'] || ''
        }

        // Validate required fields
        if (!trailerData.trailerNumber || trailerData.trailerNumber.trim() === '') {
          result.errors++
          result.errorMessages.push(`Row ${rowNum}: Trailer number is required`)
          continue
        }

        // Check for duplicates
        if (existingNumbers.has(trailerData.trailerNumber.toLowerCase())) {
          result.skipped++
          result.errorMessages.push(`Row ${rowNum}: Trailer ${trailerData.trailerNumber} already exists`)
          continue
        }

        // Create the trailer
        await prisma.trailer.create({
          data: {
            trailerNumber: trailerData.trailerNumber,
            vin: trailerData.vin || null,
            make: trailerData.make || null,
            model: trailerData.model || null,
            year: trailerData.year ?? 0,
            type: trailerData.type || null,
            status: trailerData.status as any || 'ACTIVE',
            licensePlate: trailerData.licensePlate || null,
            registrationExpiryDate: trailerData.registrationExpiryDate || null,
            currentLocation: trailerData.currentLocation || null,
            
            // Technical Specifications
            length: trailerData.length ?? 0,
            width: trailerData.width ?? 0,
            height: trailerData.height ?? 0,
            capacity: trailerData.capacity ?? 0,
            maxWeight: trailerData.maxWeight ?? 0,
            emptyWeight: trailerData.emptyWeight ?? 0,
            axleCount: trailerData.axleCount ?? 2,
            suspensionType: trailerData.suspensionType || null,
            hasThermalUnit: !!trailerData.hasThermalUnit,
            thermalUnitDetails: trailerData.thermalUnitDetails || null,
            
            // Financial and Ownership
            ownershipType: trailerData.ownershipType as any || 'Company',
            purchasePrice: trailerData.purchasePrice ?? 0,
            purchaseDate: trailerData.purchaseDate || null,
            currentValue: trailerData.currentValue ?? 0,
            monthlyLeaseCost: trailerData.monthlyLeaseCost ?? 0,
            leaseDetails: trailerData.leaseDetails || null,
            leaseAgreementExpiryDate: trailerData.leaseAgreementExpiryDate || null,
            insurancePolicyNumber: trailerData.insurancePolicyNumber || null,
            insuranceExpiryDate: trailerData.insuranceExpiryDate || null,
            
            // Maintenance
            odometerReading: trailerData.odometerReading ?? 0,
            lastInspectionDate: trailerData.lastInspectionDate || null,
            nextInspectionDueDate: trailerData.nextInspectionDueDate || null,
            lastServiceDate: trailerData.lastServiceDate || null,
            nextServiceDueDate: trailerData.nextServiceDueDate || null,
            currentCondition: trailerData.currentCondition as any || 'Good',
            maintenanceNotes: trailerData.maintenanceNotes || null,
            
            // Usage and Assignment
            assignedDriver: trailerData.assignedDriver || null,
            assignedTruck: trailerData.assignedTruck || null,
            isAssigned: !!(trailerData.assignedDriver || trailerData.assignedTruck),
            currentJobId: trailerData.currentJobId || null,
            
            // Tracking
            lastUpdated: trailerData.lastUpdated,
            updatedBy: trailerData.updatedBy,
            notes: trailerData.notes || null,
          }
        })

        result.imported++
        
        // Add to existing numbers set to prevent future duplicates in same import
        existingNumbers.add(trailerData.trailerNumber.toLowerCase())

      } catch (error: any) {
        result.errors++
        result.errorMessages.push(`Row ${rowNum}: ${error.message}`)
      }
    }

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('Trailer import error:', error)
    return NextResponse.json({ 
      error: 'Import failed: ' + error.message 
    }, { status: 500 })
  }
}

// Helper functions
function parseNumber(value: any, defaultValue = 0): number {
  if (value === null || value === undefined || value === '') return defaultValue
  const num = Number(value)
  return isNaN(num) ? defaultValue : num
}

function parseBoolean(value: any): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const lower = value.toLowerCase()
    return lower === 'true' || lower === 'yes' || lower === '1' || lower === 'y'
  }
  return false
}

function parseDate(value: any): string | null {
  if (!value) return null
  
  try {
    // Handle various date formats
    const date = new Date(value)
    if (isNaN(date.getTime())) return null
    
    return date.toISOString().split('T')[0] // Return YYYY-MM-DD format
  } catch {
    return null
  }
}

function validateStatus(status: string): string {
  const validStatuses = ['ACTIVE', 'AVAILABLE', 'MAINTENANCE', 'OUT_OF_SERVICE']
  const upper = status.toUpperCase()
  return validStatuses.includes(upper) ? upper : 'ACTIVE'
}

function validateOwnership(ownership: string): string {
  const validTypes = ['Company', 'Leased', 'Owner-Operator']
  return validTypes.includes(ownership) ? ownership : 'Company'
}

function validateCondition(condition: string): string {
  const validConditions = ['Excellent', 'Good', 'Fair', 'Poor']
  return validConditions.includes(condition) ? condition : 'Good'
}