// ===== FUEL MANAGEMENT TYPES (Complete Implementation) =====
export type FuelTransaction = {
  id: number;
  
  // Transaction Basic Info
  cardNumber?: string;
  tranDate: string;                    // Transaction date (ISO format)
  tranTime?: string;                   // Transaction time
  invoice: string;                     // Invoice number (required)
  unit?: string;                       // Truck unit number
  driverName: string;                  // Driver name (linked to employees)
  odometer?: string;                   // Odometer reading
  
  // Location Information
  locationName?: string;               // Gas station/location name
  city?: string;                       // City
  stateProv?: string;                  // State or Province
  
  // Financial Details
  fees: number;                        // Transaction fees
  item?: string;                       // Fuel type (Diesel, Gas, etc.)
  unitPrice: number;                   // Price per unit
  discPPU: number;                     // Discount per unit
  discCost: number;                    // Discount cost
  qty: number;                         // Quantity purchased
  discAmt: number;                     // Total discount amount
  discType?: string;                   // Discount type
  amt: number;                         // Total amount
  
  // System Fields
  db?: string;                         // Database identifier
  currency: string;                    // Currency
  employeeId: number;                  // Linked employee ID
  
  // Audit Fields
  createdDate?: string;
  modifiedDate?: string;
  modifiedBy?: string;
  
  // Relations
  attachments?: FuelAttachment[];
  
  // Computed Properties (for UI)
  employeeName?: string;               // Resolved from employeeId
  truckNumber?: string;                // Resolved from unit
  isLinkedToEmployee?: boolean;        // Whether employeeId > 0
  totalSavings?: number;               // discAmt + discCost
  fuelEfficiency?: number;             // Calculated MPG if odometer available
}

export type FuelAttachment = {
  id: number;
  name: string;
  url: string;
  type?: string;
  fuelTransactionId: number;
}

export type FuelImportConfig = {
  id: number;
  fieldName: string;                   // Field name in system
  columnMapping: string;               // Expected column header name
  isActive: boolean;
  isRequired: boolean;                 // Whether this field is required for import
  description?: string;                // Help text for the field
  createdDate?: string;
  modifiedDate?: string;
}

export type FuelImportResult = {
  total: number;
  imported: number;
  skipped: number;                     // Duplicates
  errors: number;
  errorMessages: string[];
}

export type FuelFilter = {
  startDate?: string;
  endDate?: string;
  driverName?: string;
  unit?: string;
  locationName?: string;
  minAmount?: number;
  maxAmount?: number;
  item?: string;                       // Fuel type filter
}

export type FuelSummary = {
  totalTransactions: number;
  totalAmount: number;
  totalQuantity: number;
  totalSavings: number;
  averagePrice: number;
  topDrivers: {
    name: string;
    transactions: number;
    totalAmount: number;
  }[];
  topLocations: {
    name: string;
    transactions: number;
    totalAmount: number;
  }[];
  fuelTypeBreakdown: {
    type: string;
    quantity: number;
    amount: number;
  }[];
}

// Default column mappings (matches Java system)
export const DEFAULT_FUEL_COLUMN_MAPPINGS: { [key: string]: string } = {
  'Card Number': 'card #',
  'Transaction Date': 'tran date',
  'Transaction Time': 'tran time',
  'Invoice': 'invoice',
  'Unit': 'unit',
  'Driver Name': 'driver name',
  'Odometer': 'odometer',
  'Location Name': 'location name',
  'City': 'city',
  'State/Province': 'state/ prov',
  'Fees': 'fees',
  'Item': 'item',
  'Unit Price': 'unit price',
  'Discount PPU': 'disc ppu',
  'Discount Cost': 'disc cost',
  'Quantity': 'qty',
  'Discount Amount': 'disc amt',
  'Discount Type': 'disc type',
  'Amount': 'amt',
  'DB': 'db',
  'Currency': 'currency'
}

// Helper functions for fuel management
export function calculateFuelSavings(transaction: FuelTransaction): number {
  return (transaction.discAmt || 0) + (transaction.discCost || 0)
}

export function getFuelTransactionDisplayName(transaction: FuelTransaction): string {
  return `${transaction.invoice} - ${transaction.driverName} (${transaction.tranDate})`
}

export function calculateFuelEfficiency(transaction: FuelTransaction, previousOdometer?: string): number | null {
  if (!transaction.odometer || !previousOdometer || !transaction.qty) return null
  
  const currentOdo = parseFloat(transaction.odometer)
  const prevOdo = parseFloat(previousOdometer)
  
  if (isNaN(currentOdo) || isNaN(prevOdo) || currentOdo <= prevOdo) return null
  
  const miles = currentOdo - prevOdo
  return miles / transaction.qty // MPG
}

export function linkFuelTransactionToEmployee(transaction: FuelTransaction, employees: any[]): FuelTransaction {
  // Find matching employee by name and truck unit (matches Java logic)
  const matchedEmployee = employees.find(emp => 
    emp.name.toLowerCase() === transaction.driverName.toLowerCase() && 
    (emp.truckUnit?.toLowerCase() === transaction.unit?.toLowerCase() || !transaction.unit)
  )
  
  return {
    ...transaction,
    employeeId: matchedEmployee?.id || 0,
    employeeName: matchedEmployee?.name,
    truckNumber: matchedEmployee?.truckUnit,
    isLinkedToEmployee: !!matchedEmployee,
    totalSavings: calculateFuelSavings(transaction)
  }
}
