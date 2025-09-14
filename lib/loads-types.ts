// ===== LOADS SYSTEM TYPES (1:1 Port from Java) =====

// Load Status - Exact match from Java Load.Status enum
export type LoadStatus = 
  | 'BOOKED' 
  | 'ASSIGNED' 
  | 'IN_TRANSIT' 
  | 'DELIVERED' 
  | 'PAID' 
  | 'CANCELLED' 
  | 'PICKUP_LATE' 
  | 'DELIVERY_LATE'

// Location Type - Exact match from Java LoadLocation.LocationType enum  
export type LocationType = 'PICKUP' | 'DROP'

// Document Type - Enhanced with PO document type
export type DocumentType = 'RATE_CONFIRMATION' | 'BOL' | 'POD' | 'PO' | 'LUMPER' | 'OTHER'

// Status color mapping - Port from Java UI
export const LOAD_STATUS_COLORS: Record<LoadStatus, string> = {
  'BOOKED': '#3B82F6',      // Blue
  'ASSIGNED': '#8B5CF6',    // Purple  
  'IN_TRANSIT': '#F59E0B',  // Amber
  'DELIVERED': '#10B981',   // Green
  'PAID': '#059669',        // Emerald
  'CANCELLED': '#EF4444',   // Red
  'PICKUP_LATE': '#DC2626', // Dark Red
  'DELIVERY_LATE': '#B91C1C' // Darker Red
}

// Status display names
export const LOAD_STATUS_LABELS: Record<LoadStatus, string> = {
  'BOOKED': 'Booked',
  'ASSIGNED': 'Assigned', 
  'IN_TRANSIT': 'In Transit',
  'DELIVERED': 'Delivered',
  'PAID': 'Paid',
  'CANCELLED': 'Cancelled',
  'PICKUP_LATE': 'Pickup Late',
  'DELIVERY_LATE': 'Delivery Late'
}

// Document type labels
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  'RATE_CONFIRMATION': 'Rate Confirmation',
  'BOL': 'Bill of Lading',
  'POD': 'Proof of Delivery',
  'PO': 'Purchase Order',
  'LUMPER': 'Lumper Receipt',
  'OTHER': 'Other'
}

// Main Load interface - Direct port from Load.java
export interface Load {
  id: number
  
  // Basic Load Information
  loadNumber: string
  poNumber?: string | null
  customer: string
  customer2?: string | null
  billTo?: string | null
  
  // Legacy single location fields (for backward compatibility)
  pickUpLocation?: string | null
  dropLocation?: string | null
  pickUpDate?: string | null    // ISO date string
  pickUpTime?: string | null    // ISO time string
  deliveryDate?: string | null  // ISO date string
  deliveryTime?: string | null  // ISO time string
  
  // Parsed location fields
  pickupCity?: string | null
  pickupState?: string | null
  deliveryCity?: string | null
  deliveryState?: string | null
  
  // Driver and Equipment Assignment
  driverId: number
  driverName?: string | null
  truckUnitSnapshot?: string | null
  trailerId: number
  trailerNumber?: string | null
  
  // Financial Information
  status: LoadStatus
  grossAmount: number
  driverRate: number
  
  // ENHANCED PAYMENT CALCULATION FIELDS
  paymentMethod?: string | null           // PERCENTAGE, PAY_PER_MILE, FLAT_RATE (snapshot from employee)
  calculatedMiles: number                 // Auto-calculated miles from zip codes
  adjustedMiles: number                   // Manually adjusted miles (overrides calculated)
  finalMiles: number                      // Final miles used for payment (calculated or adjusted)
  payPerMileRate: number                  // Rate per mile snapshot for PAY_PER_MILE method
  paymentCalculatedAt?: string | null     // ISO timestamp when payment was calculated
  paymentCalculatedBy?: string | null     // User who calculated the payment
  
  // Additional Information  
  notes?: string | null
  reminder?: string | null
  
  // Lumper Information
  hasLumper: boolean
  lumperAmount: number
  hasRevisedRateConfirmation: boolean
  
  // Audit Fields
  createdDate?: string | null
  modifiedDate?: string | null
  modifiedBy?: string | null
  
  // Relations (populated when needed)
  locations?: LoadLocation[]
  documents?: LoadDocument[]
  employee?: {
    id: number
    name: string
    truckUnit?: string | null
  } | null
  trailer?: {
    id: number
    trailerNumber: string
  } | null
}

// LoadLocation interface - Direct port from LoadLocation.java
export interface LoadLocation {
  id: number
  loadId: number
  type: LocationType
  sequence: number
  
  // Customer and Address Information
  customer?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zipCode?: string | null
  
  // Scheduling Information
  date?: string | null      // ISO date string
  time?: string | null      // ISO time string
  
  // Additional Information
  notes?: string | null
}

// LoadDocument interface - Direct port from LoadDocument inner class
export interface LoadDocument {
  id: number
  loadId: number
  fileName: string
  filePath: string
  type: DocumentType
  uploadDate?: string | null
  
  // File metadata
  fileSize: number
  contentType?: string | null
}

// Customer interface - From Java DAO customers table
export interface Customer {
  id: number
  name: string
  phone?: string | null
  email?: string | null
  createdDate?: string | null
  modifiedDate?: string | null
  isActive: boolean
}

// BillingEntity interface - From Java DAO billing_entities table
export interface BillingEntity {
  id: number
  name: string
  phone?: string | null
  email?: string | null
  address?: string | null
  createdDate?: string | null
  modifiedDate?: string | null
  isActive: boolean
}

// CustomerAddressBook interface - From Java CustomerAddress.java
export interface CustomerAddressBook {
  id: number
  customerId: number
  customerName?: string | null
  locationName?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  isDefaultPickup: boolean
  isDefaultDrop: boolean
}

// CustomerLocation interface - From Java CustomerLocation.java  
export interface CustomerLocation {
  id: number
  customerId: number
  locationType: string  // 'PICKUP' or 'DROP'
  locationName?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  isDefault: boolean
}

// ===== FILTER AND SEARCH TYPES =====

// Load filters - Based on Java LoadDAO search functionality
export interface LoadFilters {
  // Status filtering
  status?: LoadStatus | 'ALL'
  
  // Date range filtering  
  dateFrom?: string    // ISO date string
  dateTo?: string      // ISO date string
  
  // Assignment filtering
  driverId?: number | null
  trailerId?: number | null
  
  // Financial filtering
  grossMin?: number | null
  grossMax?: number | null
  
  // Quick search (searches across load number, PO, customer, notes)
  quickSearch?: string
  
  // Show only late loads
  lateOnly?: boolean
  
  // Customer/Billing filters
  customer?: string
  billTo?: string
}

// Load creation/update payload
export interface LoadCreateRequest {
  loadNumber: string
  poNumber?: string
  customer: string
  customer2?: string
  billTo?: string
  
  pickUpLocation?: string
  dropLocation?: string
  pickUpDate?: string
  pickUpTime?: string
  deliveryDate?: string
  deliveryTime?: string
  
  driverId?: number
  trailerId?: number
  
  status: LoadStatus
  grossAmount: number
  driverRate?: number
  
  notes?: string
  reminder?: string
  
  hasLumper?: boolean
  lumperAmount?: number
  hasRevisedRateConfirmation?: boolean
  
  // Multiple locations
  locations?: Omit<LoadLocation, 'id' | 'loadId'>[]
}

export interface LoadUpdateRequest extends Partial<LoadCreateRequest> {
  id: number
}

// Load summary for dashboard/reports
export interface LoadSummary {
  totalLoads: number
  totalGrossAmount: number
  totalDriverPay: number
  statusBreakdown: Record<LoadStatus, number>
  lateLoadsCount: number
  activeDriversCount: number
  revenueByMonth: { month: string, revenue: number }[]
}

// Address book entry for autocomplete
export interface AddressBookEntry {
  id: number
  customerName: string
  locationName?: string
  fullAddress: string
  city?: string
  state?: string
  isDefaultPickup: boolean
  isDefaultDrop: boolean
  usageCount: number  // How often this address is used
}

// Load statistics for performance tracking
export interface LoadStats {
  averageGrossAmount: number
  averageDriverRate: number
  averageDeliveryDays: number
  onTimeDeliveryRate: number
  mostActiveCustomers: { customer: string, loadCount: number }[]
  topDrivers: { driverName: string, loadCount: number, totalEarnings: number }[]
}

// Validation errors
export interface LoadValidationError {
  field: string
  message: string
  code: string
}

export interface LoadValidationResult {
  isValid: boolean
  errors: LoadValidationError[]
}

// Export types for easy imports
export type {
  Load as LoadEntity,
  LoadLocation as LoadLocationEntity,  
  LoadDocument as LoadDocumentEntity,
  Customer as CustomerEntity,
  BillingEntity as BillingEntityEntity,
  CustomerAddressBook as CustomerAddressBookEntity,
  CustomerLocation as CustomerLocationEntity
}

