import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { auth } from '@clerk/nextjs'
import { PayrollRow, PayrollSummaryStats } from '@/lib/types'

const prisma = new PrismaClient()

/**
 * Comprehensive Payroll Summary API - Based on Java PayrollSummaryTable.java
 * Provides advanced filtering, searching, statistics, and export functionality
 */

export async function GET(request: NextRequest) {
  try {
    const { userId } = auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    
    // Extract query parameters
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const employeeIds = searchParams.get('employeeIds')?.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));
    const searchQuery = searchParams.get('search') || '';
    const filterType = searchParams.get('filter') || 'All Drivers';
    const sortBy = searchParams.get('sortBy') || 'driverName';
    const sortOrder = searchParams.get('sortOrder') || 'asc';
    const includeInactive = searchParams.get('includeInactive') === 'true';
    const export_format = searchParams.get('format'); // csv, json, tsv

    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'Start date and end date are required' }, { status: 400 });
    }

    console.log('📊 PayrollSummary - Generating summary report', {
      startDate,
      endDate,
      employeeIds: employeeIds?.length || 'all',
      searchQuery,
      filterType,
      sortBy,
      sortOrder,
      includeInactive,
      export_format
    });

    // Get payroll data using the calculator
    const calculatorResponse = await fetch(`${process.env.NEXTURL || 'http://localhost:3000'}/api/payroll/calculator`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userId}` // Pass auth through
      },
      body: JSON.stringify({
        employeeIds,
        startDate,
        endDate,
        autoIncludeCurrentWeek: true,
        includeInactiveEmployees: includeInactive
      })
    });

    if (!calculatorResponse.ok) {
      throw new Error('Failed to calculate payroll data');
    }

    const calculatorData = await calculatorResponse.json();
    let payrollRows: PayrollRow[] = calculatorData.data.payrollRows;

    // Apply search filter
    if (searchQuery.trim()) {
      const search = searchQuery.toLowerCase().trim();
      payrollRows = payrollRows.filter(row => 
        row.driverName.toLowerCase().includes(search) ||
        (row.truckUnit && row.truckUnit.toLowerCase().includes(search))
      );
    }

    // Apply category filter (matching Java PayrollSummaryTable filters)
    payrollRows = applyFilter(payrollRows, filterType);

    // Apply sorting
    payrollRows = applySorting(payrollRows, sortBy, sortOrder);

    // Calculate comprehensive statistics
    const statistics = calculateComprehensiveStats(payrollRows);

    // Handle export formats
    if (export_format) {
      return handleExport(payrollRows, export_format, statistics, startDate, endDate);
    }

    // Return paginated results with full statistics
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    
    const paginatedRows = payrollRows.slice(startIndex, endIndex);

    console.log('✅ PayrollSummary - Generated report', {
      totalRows: payrollRows.length,
      paginatedRows: paginatedRows.length,
      totalGross: statistics.totalGross,
      totalNet: statistics.totalNet
    });

    return NextResponse.json({
      success: true,
      data: {
        payrollRows: paginatedRows,
        statistics,
        pagination: {
          page,
          limit,
          total: payrollRows.length,
          totalPages: Math.ceil(payrollRows.length / limit),
          hasNext: endIndex < payrollRows.length,
          hasPrevious: page > 1
        },
        filters: {
          applied: {
            search: searchQuery,
            filter: filterType,
            sortBy,
            sortOrder,
            includeInactive
          },
          available: {
            filters: [
              'All Drivers',
              'Positive Net Pay',
              'Negative Net Pay',
              'High Earners (>$2000)',
              'Low Net Pay (<$500)',
              'With Advances',
              'With Escrow',
              'No Loads'
            ],
            sortOptions: [
              'driverName',
              'gross',
              'netPay',
              'loadCount',
              'fuel',
              'totalDeductions'
            ]
          }
        },
        period: {
          startDate,
          endDate,
          generatedAt: new Date().toISOString(),
          generatedBy: userId
        }
      }
    });

  } catch (error) {
    console.error('❌ PayrollSummary API error:', error);
    return NextResponse.json(
      { error: 'Failed to generate payroll summary', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * Apply filter to payroll rows - From Java PayrollSummaryTable updateFilter
 */
function applyFilter(rows: PayrollRow[], filterType: string): PayrollRow[] {
  switch (filterType) {
    case 'Positive Net Pay':
      return rows.filter(row => row.netPay >= 0);
    
    case 'Negative Net Pay':
      return rows.filter(row => row.netPay < 0);
    
    case 'High Earners (>$2000)':
      return rows.filter(row => row.netPay > 2000);
    
    case 'Low Net Pay (<$500)':
      return rows.filter(row => row.netPay < 500);
    
    case 'With Advances':
      return rows.filter(row => row.advancesGiven > 0 || row.advanceRepayments > 0);
    
    case 'With Escrow':
      return rows.filter(row => row.escrowDeposits > 0);
    
    case 'No Loads':
      return rows.filter(row => row.loadCount === 0);
    
    case 'All Drivers':
    default:
      return rows;
  }
}

/**
 * Apply sorting to payroll rows
 */
function applySorting(rows: PayrollRow[], sortBy: string, sortOrder: string): PayrollRow[] {
  const isAsc = sortOrder === 'asc';
  
  return rows.sort((a, b) => {
    let valueA: any, valueB: any;
    
    switch (sortBy) {
      case 'driverName':
        valueA = a.driverName.toLowerCase();
        valueB = b.driverName.toLowerCase();
        break;
      case 'gross':
        valueA = a.gross;
        valueB = b.gross;
        break;
      case 'netPay':
        valueA = a.netPay;
        valueB = b.netPay;
        break;
      case 'loadCount':
        valueA = a.loadCount;
        valueB = b.loadCount;
        break;
      case 'fuel':
        valueA = a.fuel;
        valueB = b.fuel;
        break;
      case 'totalDeductions':
        valueA = a.serviceFee + a.fuel + a.recurringFees + a.advanceRepayments + a.escrowDeposits + a.otherDeductions;
        valueB = b.serviceFee + b.fuel + b.recurringFees + b.advanceRepayments + b.escrowDeposits + b.otherDeductions;
        break;
      default:
        valueA = a.driverName.toLowerCase();
        valueB = b.driverName.toLowerCase();
    }
    
    if (valueA < valueB) return isAsc ? -1 : 1;
    if (valueA > valueB) return isAsc ? 1 : -1;
    return 0;
  });
}

/**
 * Calculate comprehensive statistics - From Java PayrollSummaryTable getSummaryStats
 */
function calculateComprehensiveStats(rows: PayrollRow[]): PayrollSummaryStats & {
  averageGross: number;
  averageNet: number;
  averageLoads: number;
  deductionPercentage: number;
  netPayPercentage: number;
  paymentMethodBreakdown: { [key: string]: number };
  performanceMetrics: {
    topEarners: PayrollRow[];
    lowEarners: PayrollRow[];
    highestMiles: PayrollRow[];
    mostLoads: PayrollRow[];
  };
} {
  if (rows.length === 0) {
    return {
      driverCount: 0,
      totalGross: 0,
      totalNet: 0,
      totalDeductions: 0,
      totalReimbursements: 0,
      totalLoads: 0,
      driversWithNegativePay: 0,
      averageGross: 0,
      averageNet: 0,
      averageLoads: 0,
      deductionPercentage: 0,
      netPayPercentage: 0,
      paymentMethodBreakdown: {},
      performanceMetrics: {
        topEarners: [],
        lowEarners: [],
        highestMiles: [],
        mostLoads: []
      }
    };
  }

  const totalGross = rows.reduce((sum, r) => sum + r.gross, 0);
  const totalNet = rows.reduce((sum, r) => sum + r.netPay, 0);
  const totalDeductions = rows.reduce((sum, r) => 
    sum + r.serviceFee + r.fuel + r.recurringFees + r.advanceRepayments + r.escrowDeposits + r.otherDeductions, 0);
  const totalReimbursements = rows.reduce((sum, r) => sum + r.reimbursements, 0);
  const totalLoads = rows.reduce((sum, r) => sum + r.loadCount, 0);
  const driversWithNegativePay = rows.filter(r => r.netPay < 0).length;

  // Calculate performance metrics
  const sortedByNet = [...rows].sort((a, b) => b.netPay - a.netPay);
  const sortedByLoads = [...rows].sort((a, b) => b.loadCount - a.loadCount);

  // Payment method breakdown (would need to be added to PayrollRow)
  const paymentMethodBreakdown: { [key: string]: number } = {};
  
  return {
    driverCount: rows.length,
    totalGross,
    totalNet,
    totalDeductions,
    totalReimbursements,
    totalLoads,
    driversWithNegativePay,
    averageGross: totalGross / rows.length,
    averageNet: totalNet / rows.length,
    averageLoads: totalLoads / rows.length,
    deductionPercentage: totalGross > 0 ? (totalDeductions / totalGross) * 100 : 0,
    netPayPercentage: totalGross > 0 ? (totalNet / totalGross) * 100 : 0,
    paymentMethodBreakdown,
    performanceMetrics: {
      topEarners: sortedByNet.slice(0, 5),
      lowEarners: sortedByNet.slice(-5),
      highestMiles: sortedByLoads.slice(0, 5),
      mostLoads: sortedByLoads.slice(0, 5)
    }
  };
}

/**
 * Handle export formats - From Java PayrollSummaryTable export methods
 */
function handleExport(
  rows: PayrollRow[], 
  format: string, 
  statistics: any, 
  startDate: string, 
  endDate: string
): NextResponse {
  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `payroll_summary_${startDate}_to_${endDate}_${timestamp}`;

  switch (format.toLowerCase()) {
    case 'csv':
      const csvContent = generateCSV(rows, statistics, startDate, endDate);
      return new NextResponse(csvContent, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${filename}.csv"`
        }
      });

    case 'tsv':
      const tsvContent = generateTSV(rows, statistics, startDate, endDate);
      return new NextResponse(tsvContent, {
        headers: {
          'Content-Type': 'text/tab-separated-values',
          'Content-Disposition': `attachment; filename="${filename}.tsv"`
        }
      });

    case 'json':
      return NextResponse.json({
        metadata: {
          generatedAt: new Date().toISOString(),
          periodStart: startDate,
          periodEnd: endDate,
          totalRows: rows.length
        },
        statistics,
        data: rows
      }, {
        headers: {
          'Content-Disposition': `attachment; filename="${filename}.json"`
        }
      });

    default:
      throw new Error(`Unsupported export format: ${format}`);
  }
}

/**
 * Generate CSV export - From Java PayrollSummaryTable exportToCSV
 */
function generateCSV(rows: PayrollRow[], statistics: any, startDate: string, endDate: string): string {
  const lines: string[] = [];
  
  // Add BOM for Excel UTF-8 recognition
  lines.push('\ufeff');
  
  // Add header information
  lines.push(`Payroll Summary Report`);
  lines.push(`Period: ${startDate} to ${endDate}`);
  lines.push(`Generated: ${new Date().toLocaleString()}`);
  lines.push(`Total Employees: ${statistics.driverCount}`);
  lines.push(`Total Gross Pay: $${statistics.totalGross.toFixed(2)}`);
  lines.push(`Total Net Pay: $${statistics.totalNet.toFixed(2)}`);
  lines.push(``); // Empty line
  
  // Add column headers
  lines.push([
    'Driver',
    'Truck/Unit',
    'Loads',
    'Gross Pay',
    'Service Fee',
    'Gross After Fee',
    'Company Pay',
    'Driver Pay',
    'Fuel',
    'After Fuel',
    'Recurring',
    'Advances Given',
    'Advance Repayments',
    'Escrow',
    'Other Deductions',
    'Reimbursements',
    'NET PAY'
  ].map(h => `"${h}"`).join(','));
  
  // Add data rows
  rows.forEach(row => {
    lines.push([
      escapeCSV(row.driverName),
      escapeCSV(row.truckUnit),
      row.loadCount.toString(),
      row.gross.toFixed(2),
      row.serviceFee.toFixed(2),
      row.grossAfterServiceFee.toFixed(2),
      row.companyPay.toFixed(2),
      row.driverPay.toFixed(2),
      row.fuel.toFixed(2),
      row.grossAfterFuel.toFixed(2),
      row.recurringFees.toFixed(2),
      row.advancesGiven.toFixed(2),
      row.advanceRepayments.toFixed(2),
      row.escrowDeposits.toFixed(2),
      row.otherDeductions.toFixed(2),
      row.reimbursements.toFixed(2),
      row.netPay.toFixed(2)
    ].join(','));
  });
  
  return lines.join('\n');
}

/**
 * Generate TSV export
 */
function generateTSV(rows: PayrollRow[], statistics: any, startDate: string, endDate: string): string {
  const lines: string[] = [];
  
  // Add header information
  lines.push(`Payroll Summary Report`);
  lines.push(`Period: ${startDate} to ${endDate}`);
  lines.push(`Generated: ${new Date().toLocaleString()}`);
  lines.push(``); // Empty line
  
  // Add column headers
  lines.push([
    'Driver',
    'Truck/Unit',
    'Loads',
    'Gross Pay',
    'Service Fee',
    'Company Pay',
    'Driver Pay',
    'Fuel',
    'Recurring',
    'Advances Given',
    'Advance Repayments',
    'Escrow',
    'Other Deductions',
    'Reimbursements',
    'NET PAY'
  ].join('\t'));
  
  // Add data rows
  rows.forEach(row => {
    lines.push([
      row.driverName,
      row.truckUnit,
      row.loadCount.toString(),
      row.gross.toFixed(2),
      row.serviceFee.toFixed(2),
      row.companyPay.toFixed(2),
      row.driverPay.toFixed(2),
      row.fuel.toFixed(2),
      row.recurringFees.toFixed(2),
      row.advancesGiven.toFixed(2),
      row.advanceRepayments.toFixed(2),
      row.escrowDeposits.toFixed(2),
      row.otherDeductions.toFixed(2),
      row.reimbursements.toFixed(2),
      row.netPay.toFixed(2)
    ].join('\t'));
  });
  
  return lines.join('\n');
}

/**
 * Escape CSV values properly - From Java PayrollRow escapeCSV
 */
function escapeCSV(value: string): string {
  if (!value) return '""';
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}
