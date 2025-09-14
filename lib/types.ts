export type PercentageSnapshot = { ts: number; driverPercent: number; companyPercent: number; serviceFeePercent: number; note?: string };
export type AuditEntry = { ts: number; actor: string; action: string };
export type Attachment = { name: string; url: string; type?: string };

export type PaymentMethod = 'PERCENTAGE' | 'PAY_PER_MILE' | 'FLAT_RATE';

export type Employee = {
  id: number;
  name: string;
  truckUnit?: string;
  trailerNumber?: string;
  driverPercent: number;
  companyPercent: number;
  serviceFeePercent: number;
  
  // ENHANCED PAYMENT METHODS
  paymentMethod: PaymentMethod;
  payPerMileRate: number;
  
  dob?: string;
  licenseNumber?: string;
  driverType: 'OWNER_OPERATOR' | 'COMPANY_DRIVER' | 'OTHER';
  employeeLLC?: string;
  cdlExpiry?: string;
  medicalExpiry?: string;
  status: 'ACTIVE' | 'ON_LEAVE' | 'TERMINATED';
  
  // Enhanced Personal Information
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  hireDate?: string;
  emergencyContact?: string;
  emergencyPhone?: string;
  
  // CDL and Compliance
  cdlClass?: string;
  hazmatEndorsement?: boolean;
  lastDrugTest?: string;
  lastPhysical?: string;
  
  // Performance Metrics (NEW - from Java system)
  totalMilesDriven?: number;
  safetyScore?: number;
  totalLoadsCompleted?: number;
  fuelEfficiencyRating?: number;
  onTimeDeliveryRate?: number;
  accidentCount?: number;
  violationCount?: number;
  customerRating?: number;
  
  // Financial Tracking (NEW - from Java system)
  totalEarningsYTD?: number;
  totalDeductionsYTD?: number;
  advanceBalance?: number;
  escrowBalance?: number;
  weeklyPayRate?: number;
  
  // Audit and Notes
  notes?: string;
  createdDate?: string;
  modifiedDate?: string;
  modifiedBy?: string;
  
  // Relations
  attachments?: Attachment[];
  percentageHistory?: PercentageSnapshot[];
  paymentHistory?: PaymentMethodHistory[];
  audit?: AuditEntry[];
};

export type PaymentMethodHistory = {
  id: number;
  createdAt: string;
  effectiveDate: string;
  endDate?: string | null;
  
  // Payment Method Configuration
  paymentMethod: PaymentMethod;
  
  // Percentage Pay fields
  driverPercent: number;
  companyPercent: number;
  serviceFeePercent: number;
  
  // Pay Per Mile fields
  payPerMileRate: number;
  
  // Audit fields
  note?: string | null;
  createdBy?: string | null;
  employeeId: number;
};

// ===== TRUCK TYPES =====
export type TruckAttachment = {
  id: number;
  name: string;
  url: string;
  type?: string;
};

export type Truck = {
  id: number;
  number: string;
  vin?: string;
  make?: string;
  model?: string;
  year: number;
  type?: string;
  status: 'ACTIVE' | 'MAINTENANCE' | 'AVAILABLE' | 'OUT_OF_SERVICE';
  licensePlate?: string;
  
  // Compliance and Expiry
  registrationExpiryDate?: string;
  insuranceExpiryDate?: string;
  nextInspectionDue?: string;
  inspection?: string; // Last inspection date
  permitNumbers?: string;
  
  // Assignment
  driver?: string; // Assigned driver name
  assigned: boolean;
  
  // Audit
  createdDate?: string;
  modifiedDate?: string;
  modifiedBy?: string;
  notes?: string;
  
  // Relations
  attachments?: TruckAttachment[];
};

// Computed Properties for Truck
export interface TruckComputed extends Truck {
  age: number;
  displayName: string;
  isRegistrationExpired: boolean;
  isInsuranceExpired: boolean;
  isInspectionDue: boolean;
  daysUntilRegistrationExpiry: number;
  daysUntilInsuranceExpiry: number;
  daysUntilInspectionDue: number;
  complianceStatus: 'Good' | 'Warning' | 'Critical';
}

// ===== TRAILER TYPES =====
export type TrailerAttachment = {
  id: number;
  name: string;
  url: string;
  type?: string;
};

export type Trailer = {
  id: number;
  trailerNumber: string;
  vin?: string;
  make?: string;
  model?: string;
  year: number;
  type?: string;
  status: 'ACTIVE' | 'AVAILABLE' | 'MAINTENANCE' | 'OUT_OF_SERVICE';
  licensePlate?: string;
  registrationExpiryDate?: string;
  currentLocation?: string;
  
  // Technical Specifications
  length: number;
  width: number;
  height: number;
  capacity: number;
  maxWeight: number;
  emptyWeight: number;
  axleCount: number;
  suspensionType?: string;
  hasThermalUnit: boolean;
  thermalUnitDetails?: string;
  
  // Financial and Ownership
  ownershipType: 'Company' | 'Leased' | 'Owner-Operator';
  purchasePrice: number;
  purchaseDate?: string;
  currentValue: number;
  monthlyLeaseCost: number;
  leaseDetails?: string;
  leaseAgreementExpiryDate?: string;
  insurancePolicyNumber?: string;
  insuranceExpiryDate?: string;
  
  // Maintenance
  odometerReading: number;
  lastInspectionDate?: string;
  nextInspectionDueDate?: string;
  lastServiceDate?: string;
  nextServiceDueDate?: string;
  currentCondition: 'Excellent' | 'Good' | 'Fair' | 'Poor';
  maintenanceNotes?: string;
  
  // Usage and Assignment
  assignedDriver?: string;
  assignedTruck?: string;
  isAssigned: boolean;
  currentJobId?: string;
  
  // Tracking
  lastUpdated?: string;
  updatedBy?: string;
  notes?: string;
  
  // Relations
  attachments?: TrailerAttachment[];
};

// Computed Properties for Trailer
export interface TrailerComputed extends Trailer {
  age: number;
  payload: number;
  displayName: string;
  isRegistrationExpired: boolean;
  isInsuranceExpired: boolean;
  isLeaseAgreementExpired: boolean;
  isInspectionDue: boolean;
  isServiceDue: boolean;
  daysUntilRegistrationExpiry: number;
  daysUntilInsuranceExpiry: number;
  daysUntilLeaseAgreementExpiry: number;
  daysUntilInspectionDue: number;
  daysUntilServiceDue: number;
  complianceStatus: 'Good' | 'Warning' | 'Critical';
  financialStatus: 'Owned' | 'Leased' | 'Lease Expiring';
}

// ===== HELPER FUNCTIONS =====

// Truck Helper Functions
export const TruckHelpers = {
  getAge: (truck: Truck): number => {
    return truck.year > 0 ? new Date().getFullYear() - truck.year : 0;
  },
  
  getDisplayName: (truck: Truck): string => {
    const parts = [
      truck.number,
      truck.make,
      truck.model,
      truck.year > 0 ? `(${truck.year})` : null
    ].filter(Boolean);
    return parts.join(' ');
  },
  
  isRegistrationExpired: (truck: Truck): boolean => {
    if (!truck.registrationExpiryDate) return false;
    return new Date(truck.registrationExpiryDate) < new Date();
  },
  
  isInsuranceExpired: (truck: Truck): boolean => {
    if (!truck.insuranceExpiryDate) return false;
    return new Date(truck.insuranceExpiryDate) < new Date();
  },
  
  isInspectionDue: (truck: Truck): boolean => {
    if (!truck.nextInspectionDue) return false;
    return new Date(truck.nextInspectionDue) <= new Date();
  },
  
  getDaysUntilExpiry: (dateStr?: string): number => {
    if (!dateStr) return 999999;
    const expiry = new Date(dateStr);
    const now = new Date();
    const diffTime = expiry.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  },
  
  getComplianceStatus: (truck: Truck): 'Good' | 'Warning' | 'Critical' => {
    const regDays = TruckHelpers.getDaysUntilExpiry(truck.registrationExpiryDate);
    const insDays = TruckHelpers.getDaysUntilExpiry(truck.insuranceExpiryDate);
    const inspDays = TruckHelpers.getDaysUntilExpiry(truck.nextInspectionDue);
    
    const minDays = Math.min(regDays, insDays, inspDays);
    
    if (minDays < 0) return 'Critical'; // Expired
    if (minDays <= 30) return 'Critical'; // 30 days or less
    if (minDays <= 60) return 'Warning'; // 60 days or less
    return 'Good';
  }
};

// Trailer Helper Functions
// ===== ADDRESS BOOK TYPES =====
export type AddressBookEntry = {
  id: number;
  name: string;
  type: string; // CUSTOMER, BROKER, SHIPPER, CONSIGNEE, VENDOR
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  country: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  fax?: string | null;
  website?: string | null;
  notes?: string | null;
  taxId?: string | null;
  mcNumber?: string | null;
  dotNumber?: string | null;
  creditLimit: number;
  paymentTerms?: string | null;
  preferredRate: number;
  isActive: boolean;
  createdDate?: string | null;
  modifiedDate?: string | null;
  modifiedBy?: string | null;
};

export const AddressBookHelpers = {
  formatAddress: (entry: AddressBookEntry): string => {
    const parts = [];
    if (entry.address) parts.push(entry.address);
    if (entry.city) parts.push(entry.city);
    if (entry.state) parts.push(entry.state);
    if (entry.zipCode) parts.push(entry.zipCode);
    return parts.join(', ');
  },

  getDisplayName: (entry: AddressBookEntry): string => {
    return `${entry.name}${entry.contactPerson ? ` (${entry.contactPerson})` : ''}`;
  },

  getTypeColor: (type: string): string => {
    const typeColors: { [key: string]: string } = {
      'CUSTOMER': 'bg-blue-100 text-blue-800',
      'BROKER': 'bg-green-100 text-green-800',
      'SHIPPER': 'bg-purple-100 text-purple-800',
      'CONSIGNEE': 'bg-orange-100 text-orange-800',
      'VENDOR': 'bg-gray-100 text-gray-800'
    };
    return typeColors[type] || 'bg-slate-100 text-slate-800';
  }
};

export const TrailerHelpers = {
  getAge: (trailer: Trailer): number => {
    return trailer.year > 0 ? new Date().getFullYear() - trailer.year : 0;
  },
  
  getPayload: (trailer: Trailer): number => {
    return trailer.maxWeight - trailer.emptyWeight;
  },
  
  getDisplayName: (trailer: Trailer): string => {
    const parts = [
      trailer.trailerNumber,
      trailer.make,
      trailer.model,
      trailer.year > 0 ? `(${trailer.year})` : null
    ].filter(Boolean);
    return parts.join(' ');
  },
  
  isRegistrationExpired: (trailer: Trailer): boolean => {
    if (!trailer.registrationExpiryDate) return false;
    return new Date(trailer.registrationExpiryDate) < new Date();
  },
  
  isInsuranceExpired: (trailer: Trailer): boolean => {
    if (!trailer.insuranceExpiryDate) return false;
    return new Date(trailer.insuranceExpiryDate) < new Date();
  },
  
  isLeaseAgreementExpired: (trailer: Trailer): boolean => {
    if (!trailer.leaseAgreementExpiryDate) return false;
    return new Date(trailer.leaseAgreementExpiryDate) < new Date();
  },
  
  isInspectionDue: (trailer: Trailer): boolean => {
    if (!trailer.nextInspectionDueDate) return false;
    return new Date(trailer.nextInspectionDueDate) <= new Date();
  },
  
  isServiceDue: (trailer: Trailer): boolean => {
    if (!trailer.nextServiceDueDate) return false;
    return new Date(trailer.nextServiceDueDate) <= new Date();
  },
  
  getDaysUntilExpiry: (dateStr?: string): number => {
    if (!dateStr) return 999999;
    const expiry = new Date(dateStr);
    const now = new Date();
    const diffTime = expiry.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  },
  
  getComplianceStatus: (trailer: Trailer): 'Good' | 'Warning' | 'Critical' => {
    const regDays = TrailerHelpers.getDaysUntilExpiry(trailer.registrationExpiryDate);
    const insDays = TrailerHelpers.getDaysUntilExpiry(trailer.insuranceExpiryDate);
    const inspDays = TrailerHelpers.getDaysUntilExpiry(trailer.nextInspectionDueDate);
    const serviceDays = TrailerHelpers.getDaysUntilExpiry(trailer.nextServiceDueDate);
    
    const minDays = Math.min(regDays, insDays, inspDays, serviceDays);
    
    if (minDays < 0) return 'Critical'; // Expired
    if (minDays <= 30) return 'Critical'; // 30 days or less
    if (minDays <= 60) return 'Warning'; // 60 days or less
    return 'Good';
  },
  
  getFinancialStatus: (trailer: Trailer): 'Owned' | 'Leased' | 'Lease Expiring' => {
    if (trailer.ownershipType === 'Company') return 'Owned';
    if (!trailer.leaseAgreementExpiryDate) return 'Leased';
    
    const daysUntilExpiry = TrailerHelpers.getDaysUntilExpiry(trailer.leaseAgreementExpiryDate);
    return daysUntilExpiry <= 90 ? 'Lease Expiring' : 'Leased';
  }
};

// Computed Properties (NEW - from Java system)
export interface EmployeeComputed extends Employee {
  isDriver: boolean;
  isActive: boolean;
  age: number;
  yearsOfService: number;
  isCdlExpired: boolean;
  isMedicalExpired: boolean;
  daysUntilCdlExpiry: number;
  daysUntilMedicalExpiry: number;
  needsDrugTest: boolean;
  needsPhysical: boolean;
  performanceRating: 'Excellent' | 'Good' | 'Average' | 'Needs Improvement';
  netEarningsYTD: number;
  fullAddress: string;
}

// Employee Helper Functions
export const EmployeeHelpers = {
  isDriver: (emp: Employee): boolean => 
    emp.driverType === 'OWNER_OPERATOR' || emp.driverType === 'COMPANY_DRIVER',
    
  isActive: (emp: Employee): boolean => 
    emp.status === 'ACTIVE',
    
  getAge: (emp: Employee): number => {
    if (!emp.dob) return 0;
    const birthDate = new Date(emp.dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  },
  
  getYearsOfService: (emp: Employee): number => {
    if (!emp.hireDate) return 0;
    const hireDate = new Date(emp.hireDate);
    const today = new Date();
    let years = today.getFullYear() - hireDate.getFullYear();
    const monthDiff = today.getMonth() - hireDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < hireDate.getDate())) {
      years--;
    }
    return Math.max(0, years);
  },
  
  isCdlExpired: (emp: Employee): boolean => {
    if (!emp.cdlExpiry) return false;
    return new Date(emp.cdlExpiry) < new Date();
  },
  
  isMedicalExpired: (emp: Employee): boolean => {
    if (!emp.medicalExpiry) return false;
    return new Date(emp.medicalExpiry) < new Date();
  },
  
  getDaysUntilCdlExpiry: (emp: Employee): number => {
    if (!emp.cdlExpiry) return -1;
    const expiryDate = new Date(emp.cdlExpiry);
    const today = new Date();
    const diffTime = expiryDate.getTime() - today.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  },
  
  getDaysUntilMedicalExpiry: (emp: Employee): number => {
    if (!emp.medicalExpiry) return -1;
    const expiryDate = new Date(emp.medicalExpiry);
    const today = new Date();
    const diffTime = expiryDate.getTime() - today.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  },
  
  needsDrugTest: (emp: Employee): boolean => {
    if (!emp.lastDrugTest) return true;
    const lastTest = new Date(emp.lastDrugTest);
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    return lastTest < sixMonthsAgo;
  },
  
  needsPhysical: (emp: Employee): boolean => {
    if (!emp.lastPhysical) return true;
    const lastPhysical = new Date(emp.lastPhysical);
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    return lastPhysical < twoYearsAgo;
  },
  
  getPerformanceRating: (emp: Employee): 'Excellent' | 'Good' | 'Average' | 'Needs Improvement' => {
    const safety = emp.safetyScore || 0;
    const onTime = emp.onTimeDeliveryRate || 0;
    const rating = emp.customerRating || 0;
    
    if (safety >= 90 && onTime >= 95 && rating >= 4.5) {
      return 'Excellent';
    } else if (safety >= 80 && onTime >= 90 && rating >= 4.0) {
      return 'Good';
    } else if (safety >= 70 && onTime >= 85 && rating >= 3.5) {
      return 'Average';
    } else {
      return 'Needs Improvement';
    }
  },
  
  getNetEarningsYTD: (emp: Employee): number => {
    return (emp.totalEarningsYTD || 0) - (emp.totalDeductionsYTD || 0);
  },
  
  getFullAddress: (emp: Employee): string => {
    if (!emp.address || !emp.city || !emp.state || !emp.zipCode) {
      return '';
    }
    return `${emp.address}, ${emp.city}, ${emp.state} ${emp.zipCode}`;
  }
};

// ===== PAYROLL SYSTEM TYPES =====

export type PayrollPeriodType = 'WEEKLY' | 'BI_WEEKLY';
export type PayrollStatus = 'DRAFT' | 'PROCESSING' | 'APPROVED' | 'PAID' | 'CLOSED';
export type PaystubStatus = 'DRAFT' | 'APPROVED' | 'PAID';
export type DeductionType = 'FEDERAL_TAX' | 'STATE_TAX' | 'FICA' | 'MEDICARE' | 'INSURANCE' | '401K' | 'UNION_DUES' | 'ADVANCE_REPAY' | 'OTHER';
export type CalculationType = 'PERCENTAGE' | 'FIXED_AMOUNT' | 'PERCENTAGE_OF_GROSS';
export type AdvanceStatus = 'ACTIVE' | 'PAID' | 'CANCELLED';
export type RepaymentType = 'WEEKLY' | 'LUMP_SUM' | 'CUSTOM';

export type PayrollPeriod = {
  id: number;
  periodName: string;
  periodType: PayrollPeriodType;
  startDate: string;
  endDate: string;
  payDate: string;
  status: PayrollStatus;
  totalGrossPay: number;
  totalNetPay: number;
  totalDeductions: number;
  employeeCount: number;
  createdDate?: string | null;
  processedDate?: string | null;
  approvedDate?: string | null;
  paidDate?: string | null;
  modifiedDate?: string | null;
  createdBy?: string | null;
  approvedBy?: string | null;
  paystubs?: Paystub[];
};

export type Paystub = {
  id: number;
  payrollId: number;
  employeeId: number;
  employeeName: string;
  weekStartDate: string;
  weekEndDate: string;
  payDate?: string | null;
  paymentMethod: string;
  basePayRate: number;
  totalMiles: number;
  totalLoads: number;
  grossRevenue: number;
  basePay: number;
  bonusAmount: number;
  overtime: number;
  reimbursements: number;
  otherEarnings: number;
  totalDeductions: number;
  fuelDeductions: number;
  advanceRepayments: number;
  otherDeductions: number;
  grossPay: number;
  netPay: number;
  status: PaystubStatus;
  generatedDate?: string | null;
  approvedDate?: string | null;
  paidDate?: string | null;
  createdDate?: string | null;
  modifiedDate?: string | null;
  createdBy?: string | null;
  payroll?: IndividualPayroll;
  deductions?: PayrollDeduction[];
  reimbursementRecords?: PayrollReimbursement[];
  adjustments?: PayrollAdjustment[];
  advances?: PayrollAdvance[];
};

export type PayrollDeduction = {
  id: number;
  paystubId: number;
  deductionType: DeductionType;
  deductionName: string;
  description?: string | null;
  calculationType: CalculationType;
  rate: number;
  baseAmount: number;
  deductedAmount: number;
  taxYear?: number | null;
  isPreTax: boolean;
  category: string;
  loadNumber?: string | null;
  referenceNumber?: string | null;
  status: string;
  createdDate?: string | null;
  modifiedDate?: string | null;
  createdBy?: string | null;
  paystub?: Paystub;
};

export type PayrollReimbursement = {
  id: number;
  paystubId: number;
  employeeId: number;
  reimbursementType: string;
  reimbursementName: string;
  description?: string | null;
  amount: number;
  loadNumber?: string | null;
  referenceNumber?: string | null;
  category: string;
  status: string;
  approvedBy?: string | null;
  approvedDate?: string | null;
  createdDate?: string | null;
  modifiedDate?: string | null;
  createdBy?: string | null;
  paystub?: Paystub;
};

// Individual Payroll - Core payroll processing record
export type IndividualPayroll = {
  id: number;
  employeeId: number;
  employeeName: string;
  weekStartDate: string;
  weekEndDate: string;
  payDate?: string | null;
  
  // Load Summary
  totalLoads: number;
  totalMiles: number;
  grossRevenue: number;
  
  // Payment Calculation
  paymentMethod?: string | null;
  basePayRate: number;
  basePay: number;
  
  // Earnings
  bonusAmount: number;
  reimbursements: number;
  overtime: number;
  otherEarnings: number;
  
  // Deductions
  totalDeductions: number;
  fuelDeductions: number;
  advanceRepayments: number;
  otherDeductions: number;
  
  // Totals
  grossPay: number;
  netPay: number;
  
  // Status
  status: string;
  isLocked: boolean;
  
  // Processing Info
  calculatedDate?: string | null;
  calculatedBy?: string | null;
  reviewedDate?: string | null;
  reviewedBy?: string | null;
  processedDate?: string | null;
  processedBy?: string | null;
  notes?: string | null;
  
  // System
  createdDate?: string | null;
  modifiedDate?: string | null;
  createdBy?: string | null;
  
  // Relations
  loads?: PayrollLoad[];
  adjustments?: PayrollAdjustment[];
  paystub?: Paystub | null;
};

// Payroll Load - Links loads to payroll
export type PayrollLoad = {
  id: number;
  payrollId: number;
  loadId: number;
  
  // Load Snapshot
  loadNumber: string;
  grossAmount: number;
  driverRate: number;
  finalMiles: number;
  deliveryDate?: string | null;
  
  // Payment Method Snapshot
  paymentMethod?: string | null;
  payPerMileRate: number;
  driverPercent: number;
  
  // Status
  isIncluded: boolean;
  notes?: string | null;
  createdDate?: string | null;
  
  // Relations
  payroll?: IndividualPayroll;
};

export type PayrollAdjustment = {
  id: number;
  employeeId: number;
  payrollId?: number | null;
  paystubId?: number | null;
  category: string;
  adjustmentType: string;
  adjustmentName: string;
  description?: string | null;
  amount: number;
  isRecurring: boolean;
  effectiveDate: string;
  weekStartDate?: string | null;
  loadNumber?: string | null;
  referenceNumber?: string | null;
  status: string;
  approvedBy?: string | null;
  approvedDate?: string | null;
  reversedBy?: string | null;
  reversedDate?: string | null;
  reverseReason?: string | null;
  createdDate?: string | null;
  modifiedDate?: string | null;
  createdBy?: string | null;
  payroll?: IndividualPayroll | null;
  paystub?: Paystub | null;
};

export type PayrollAdvance = {
  id: number;
  employeeId: number;
  paystubId?: number | null;
  advanceAmount: number;
  repaidAmount: number;
  remainingBalance: number;
  advanceDate: string;
  dueDate?: string | null;
  repaymentType: RepaymentType;
  weeklyRepayment: number;
  status: AdvanceStatus;
  approvedBy?: string | null;
  reason?: string | null;
  notes?: string | null;
  createdDate?: string | null;
  modifiedDate?: string | null;
  createdBy?: string | null;
  paystub?: Paystub | null;
};

// Payroll calculation result
export type PayrollCalculationResult = {
  employeeId: number;
  employeeName: string;
  paymentMethod: PaymentMethod;
  totalMiles: number;
  totalLoads: number;
  grossRevenue: number;
  grossPay: number;
  deductions: {
    type: DeductionType;
    name: string;
    amount: number;
  }[];
  totalDeductions: number;
  netPay: number;
  advances: {
    id: number;
    repaymentAmount: number;
  }[];
};

// Payroll summary for periods
export type PayrollSummary = {
  totalEmployees: number;
  totalGrossPay: number;
  totalDeductions: number;
  totalNetPay: number;
  totalMiles: number;
  totalLoads: number;
  averagePayPerEmployee: number;
};

// Helper functions for payroll calculations
export const PayrollHelpers = {
  generatePeriodName: (startDate: string, periodType: PayrollPeriodType): string => {
    const start = new Date(startDate);
    const options: Intl.DateTimeFormatOptions = { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    };
    
    switch (periodType) {
      case 'WEEKLY':
        return `Week of ${start.toLocaleDateString('en-US', options)}`;
      case 'BI_WEEKLY':
        const end = new Date(start);
        end.setDate(start.getDate() + 13);
        return `Bi-Weekly ${start.toLocaleDateString('en-US', options)} - ${end.toLocaleDateString('en-US', options)}`;
      default:
        return `Period ${start.toLocaleDateString('en-US', options)}`;
    }
  },

  calculateFederalTax: (grossPay: number, payPeriods: number = 52): number => {
    // Simple federal tax calculation - would need more complex logic for real-world
    const annualizedPay = grossPay * payPeriods;
    let taxRate = 0.10; // 10% base rate
    
    if (annualizedPay > 40000) taxRate = 0.12;
    if (annualizedPay > 85000) taxRate = 0.22;
    if (annualizedPay > 163000) taxRate = 0.24;
    
    return grossPay * taxRate;
  },

  calculateStateTax: (grossPay: number, state: string = 'MI'): number => {
    // Simple state tax calculation - Michigan example
    const stateTaxRates: { [key: string]: number } = {
      'MI': 0.0425, // Michigan 4.25%
      'TX': 0.0000, // Texas has no state income tax
      'CA': 0.0600, // California approximate
      'FL': 0.0000, // Florida has no state income tax
    };
    
    const rate = stateTaxRates[state] || 0.05; // Default 5%
    return grossPay * rate;
  },

  calculateFICA: (grossPay: number): number => {
    // Social Security: 6.2% up to wage base
    const socialSecurityRate = 0.062;
    const socialSecurityBase = 160200; // 2023 wage base
    const medicare = grossPay * 0.0145; // Medicare: 1.45%
    
    // For simplicity, assuming under wage base
    const socialSecurity = Math.min(grossPay * socialSecurityRate, socialSecurityBase * socialSecurityRate);
    
    return socialSecurity + medicare;
  },

  formatCurrency: (amount: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2
    }).format(amount);
  },

  getPayrollStatusColor: (status: PayrollStatus): string => {
    const statusColors: { [key in PayrollStatus]: string } = {
      'DRAFT': 'bg-slate-100 text-slate-800',
      'PROCESSING': 'bg-blue-100 text-blue-800',
      'APPROVED': 'bg-green-100 text-green-800',
      'PAID': 'bg-emerald-100 text-emerald-800',
      'CLOSED': 'bg-gray-100 text-gray-800'
    };
    return statusColors[status] || 'bg-slate-100 text-slate-800';
  },

  getPaystubStatusColor: (status: PaystubStatus): string => {
    const statusColors: { [key in PaystubStatus]: string } = {
      'DRAFT': 'bg-slate-100 text-slate-800',
      'APPROVED': 'bg-green-100 text-green-800',
      'PAID': 'bg-emerald-100 text-emerald-800'
    };
    return statusColors[status] || 'bg-slate-100 text-slate-800';
  },

  // Enhanced calculation functions from Java PayrollCalculator
  calculateServiceFee: (grossAmount: number, serviceFeePercent: number): number => {
    return (grossAmount * serviceFeePercent) / 100;
  },

  calculateDriverPay: (grossAmount: number, driverPercent: number, serviceFee: number): number => {
    return ((grossAmount - serviceFee) * driverPercent) / 100;
  },

  calculateCompanyPay: (grossAmount: number, companyPercent: number, serviceFee: number): number => {
    return ((grossAmount - serviceFee) * companyPercent) / 100 + serviceFee;
  },

  // Advance calculation helpers (from Java PayrollAdvances.java)
  calculateWeeklyRepayment: (totalAmount: number, weeks: number): number => {
    return Math.ceil((totalAmount / weeks) * 100) / 100; // Round up to nearest cent
  },

  calculateAutoRepayment: (grossPay: number, maxRepayment: number = 200): number => {
    const tenPercent = grossPay * 0.10;
    return Math.min(tenPercent, maxRepayment);
  },

  // Escrow calculation helpers (from Java PayrollEscrow.java)
  calculateEscrowDeposit: (
    grossPay: number,
    currentBalance: number,
    targetAmount: number,
    targetWeeks: number = 6,
    maxWeeklyDeposit: number = 500,
    minNetPay: number = 500
  ): number => {
    const remaining = Math.max(0, targetAmount - currentBalance);
    if (remaining <= 0) return 0;

    const weeklyTarget = Math.ceil(remaining / targetWeeks);
    const affordableAmount = Math.max(0, grossPay - minNetPay);
    const maxDeposit = Math.min(weeklyTarget, maxWeeklyDeposit);
    
    return Math.min(maxDeposit, affordableAmount);
  },

  // Date utility functions
  getWeekStartDate: (date: Date): string => {
    const start = new Date(date);
    start.setDate(date.getDate() - date.getDay() + 1); // Monday
    start.setHours(0, 0, 0, 0);
    return start.toISOString().split('T')[0];
  },

  getWeekEndDate: (date: Date): string => {
    const end = new Date(date);
    end.setDate(date.getDate() - date.getDay() + 7); // Sunday
    end.setHours(23, 59, 59, 999);
    return end.toISOString().split('T')[0];
  },

  // Validation helpers
  isValidAdvanceAmount: (amount: number, minAdvance: number = 50, maxAdvance: number = 5000): boolean => {
    return amount >= minAdvance && amount <= maxAdvance;
  },

  isValidRepaymentWeeks: (weeks: number, minWeeks: number = 1, maxWeeks: number = 26): boolean => {
    return weeks >= minWeeks && weeks <= maxWeeks;
  },

  // Status helpers
  getAdvanceStatusColor: (status: string): string => {
    const colors: { [key: string]: string } = {
      'ACTIVE': 'bg-blue-100 text-blue-800',
      'COMPLETED': 'bg-green-100 text-green-800',
      'DEFAULTED': 'bg-red-100 text-red-800',
      'FORGIVEN': 'bg-purple-100 text-purple-800',
      'CANCELLED': 'bg-gray-100 text-gray-800'
    };
    return colors[status] || 'bg-slate-100 text-slate-800';
  },

  getCurrentWeek: (): { start: string; end: string } => {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay() + 1); // Monday
    startOfWeek.setHours(0, 0, 0, 0);
    
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6); // Sunday
    endOfWeek.setHours(23, 59, 59, 999);
    
    return {
      start: startOfWeek.toISOString().split('T')[0],
      end: endOfWeek.toISOString().split('T')[0],
    };
  },

  getBiWeekly: (date: Date = new Date()): { start: string; end: string } => {
    const startOfWeek = new Date(date);
    startOfWeek.setDate(date.getDate() - date.getDay() + 1); // Monday
    startOfWeek.setHours(0, 0, 0, 0);
    
    const endOfBiWeek = new Date(startOfWeek);
    endOfBiWeek.setDate(startOfWeek.getDate() + 13); // Two weeks
    endOfBiWeek.setHours(23, 59, 59, 999);
    
    return {
      start: startOfWeek.toISOString().split('T')[0],
      end: endOfBiWeek.toISOString().split('T')[0],
    };
  },
};

// ===== COMPREHENSIVE PAYROLL TYPES (Enhanced from Java system) =====

// Advance types (from Java PayrollAdvances.java)
export type AdvanceType = 'ADVANCE' | 'REPAYMENT' | 'ADJUSTMENT' | 'FORGIVENESS';
export type PaymentMethodType = 'PAYROLL_DEDUCTION' | 'CASH' | 'CHECK' | 'BANK_TRANSFER' | 'OTHER';
export type AdvanceStatusType = 'ACTIVE' | 'COMPLETED' | 'DEFAULTED' | 'FORGIVEN' | 'CANCELLED';

// Recurring deduction types (from Java PayrollRecurring.java)
export type RecurringType = 'ELD' | 'IFTA' | 'TVC' | 'PARKING' | 'PRE-PASS' | 'OTHER';
export type RecurringFrequency = 'WEEKLY' | 'BI_WEEKLY' | 'MONTHLY';

// Payroll calculation row (from Java PayrollCalculator.PayrollRow)
export type PayrollRow = {
  driverId: number;
  driverName: string;
  truckUnit: string;
  loadCount: number;
  gross: number;
  serviceFee: number;
  grossAfterServiceFee: number;
  companyPay: number;
  driverPay: number; // Final take-home pay (NET PAY)
  driverGrossShare: number; // Driver's share before final deductions
  fuel: number;
  grossAfterFuel: number;
  recurringFees: number;
  advancesGiven: number;
  advanceRepayments: number;
  escrowDeposits: number;
  otherDeductions: number;
  reimbursements: number;
  netPay: number; // Same as driverPay
  loads: any[]; // Loads included
  fuels: any[]; // Fuel transactions
  companyPercent: number;
  driverPercent: number;
  serviceFeePercent: number;
};

// Enhanced payroll types
export type PayrollRecurring = {
  id: number;
  driverId: number;
  weekStart: string;
  recurringType: RecurringType;
  amount: number;
  description?: string | null;
  isActive: boolean;
  isRecurring: boolean;
  frequency: RecurringFrequency;
  nextDeductionDate?: string | null;
  endDate?: string | null;
  createdDate?: string | null;
  modifiedDate?: string | null;
  createdBy?: string | null;
};

export type PayrollEscrow = {
  id: number;
  employeeId: number;
  employeeName: string;
  currentBalance: number;
  targetAmount: number;
  weeklyAmount: number;
  isFunded: boolean;
  isActive: boolean;
  autoDeposit: boolean;
  maxWeeklyDeposit: number;
  minWeeklyDeposit: number;
  targetWeeks: number;
  createdDate?: string | null;
  modifiedDate?: string | null;
  lastDepositDate?: string | null;
  fullyFundedDate?: string | null;
  createdBy?: string | null;
  modifiedBy?: string | null;
  deposits?: PayrollEscrowTransaction[];
};

export type PayrollEscrowTransaction = {
  id: number;
  escrowId: number;
  employeeId: number;
  paystubId?: number | null;
  transactionType: string; // DEPOSIT, WITHDRAWAL, ADJUSTMENT, INTEREST
  amount: number;
  description?: string | null;
  balanceBefore: number;
  balanceAfter: number;
  transactionDate: string;
  effectiveDate: string;
  weekStartDate?: string | null;
  authorizedBy?: string | null;
  reason?: string | null;
  createdDate?: string | null;
  createdBy?: string | null;
  escrow?: PayrollEscrow;
  paystub?: Paystub | null;
};

export type PayrollFuelIntegration = {
  id: number;
  payrollId?: number | null;
  fuelTransactionId: number;
  employeeId: number;
  fuelInvoice: string;
  fuelAmount: number;
  fuelDate: string;
  location?: string | null;
  weekStartDate: string;
  isIncluded: boolean;
  deductionAmount: number;
  processedDate?: string | null;
  processedBy?: string | null;
  createdDate?: string | null;
  payroll?: IndividualPayroll | null;
};

export type PayrollHistory = {
  id: number;
  employeeId: number;
  employeeName: string;
  periodType: string;
  weekStartDate: string;
  weekEndDate: string;
  payDate: string;
  grossPay: number;
  totalDeductions: number;
  netPay: number;
  totalLoads: number;
  totalMiles: number;
  averagePayPerMile: number;
  paymentMethod?: string | null;
  payrollStatus: string;
  paidDate?: string | null;
  createdDate?: string | null;
  processedDate?: string | null;
  archivedDate?: string | null;
};

export type PayrollSettings = {
  id: number;
  defaultPayFrequency: string;
  defaultPayDay: number;
  autoCalculatePayroll: boolean;
  autoIncludeCurrentWeek: boolean;
  requireApproval: boolean;
  federalTaxRate: number;
  stateTaxRate: number;
  ficaRate: number;
  medicareRate: number;
  maxAdvanceAmount: number;
  maxAdvanceWeeks: number;
  defaultAdvanceWeeks: number;
  defaultEscrowTarget: number;
  maxWeeklyEscrowDeposit: number;
  minWeeklyEscrowDeposit: number;
  escrowTargetWeeks: number;
  minNetPayThreshold: number;
  maxAutoRepayment: number;
  isActive: boolean;
  createdDate?: string | null;
  modifiedDate?: string | null;
  modifiedBy?: string | null;
};

// Enhanced advance type (from Java PayrollAdvances.AdvanceEntry)
export type EnhancedPayrollAdvance = {
  id: number;
  employeeId: number;
  paystubId?: number | null;
  advanceId: string;
  advanceType: AdvanceType;
  parentAdvanceId?: string | null;
  advanceAmount: number;
  amount: number; // Transaction amount (negative for repayments)
  repaidAmount: number;
  remainingBalance: number;
  advanceDate: string;
  weekStartDate: string;
  dueDate?: string | null;
  firstRepaymentDate?: string | null;
  lastRepaymentDate?: string | null;
  repaymentType: PaymentMethodType;
  weeksToRepay: number;
  weeklyRepayment: number;
  paymentMethod?: PaymentMethodType | null;
  referenceNumber?: string | null;
  status: AdvanceStatusType;
  approvedBy?: string | null;
  approvedDate?: string | null;
  processedBy?: string | null;
  processedDate?: string | null;
  reason?: string | null;
  notes?: string | null;
  createdDate?: string | null;
  modifiedDate?: string | null;
  createdBy?: string | null;
  paystub?: Paystub | null;
};

// Payroll calculation summary (from Java PayrollSummaryTable)
export type PayrollSummaryStats = {
  driverCount: number;
  totalGross: number;
  totalNet: number;
  totalDeductions: number;
  totalReimbursements: number;
  totalLoads: number;
  driversWithNegativePay: number;
};

export type AdjustmentSummary = {
  driverId: number;
  totalDeductions: number;
  totalReimbursements: number;
  totalBonuses: number;
  totalFuelDeductions: number;
  adjustmentCount: number;
  netAdjustment: number;
};
