import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

// GET /api/payroll/paystubs/[id]/pdf - Generate paystub PDF
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const paystubId = parseInt(params.id)
    
    if (isNaN(paystubId)) {
      return NextResponse.json(
        { error: 'Invalid paystub ID' },
        { status: 400 }
      )
    }

    // Get paystub with all related data
    const paystub = await prisma.paystub.findUnique({
      where: { id: paystubId },
      include: {
        payroll: {
          include: {
            loads: true
          }
        }
      }
    })

    if (!paystub) {
      return NextResponse.json(
        { error: 'Paystub not found' },
        { status: 404 }
      )
    }

    // Get employee details
    const employee = await prisma.employee.findUnique({
      where: { id: paystub.employeeId }
    })

    // Get company configuration
    const companyConfig = await prisma.companyConfig.findFirst({
      where: { isActive: true }
    })

    // Generate PDF
    const pdfBytes = await generatePaystubPDF(paystub, employee, companyConfig)

    // Generate filename
    const filename = `Paystub_${paystub.employeeName.replace(/[^a-zA-Z0-9]/g, '_')}_Week_${getCurrentWeekNumber(paystub.weekStartDate)}_${new Date(paystub.weekStartDate).getFullYear()}.pdf`

    return new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': pdfBytes.length.toString()
      }
    })

  } catch (error) {
    console.error('Error generating paystub PDF:', error)
    return NextResponse.json(
      { error: 'Failed to generate paystub PDF' },
      { status: 500 }
    )
  }
}

// Generate professional paystub PDF
async function generatePaystubPDF(paystub: any, employee: any, companyConfig: any): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([612, 792])
  const { width, height } = page.getSize()

  const titleFont = await pdf.embedFont(StandardFonts.HelveticaBold)
  const bodyFont = await pdf.embedFont(StandardFonts.Helvetica)

  let y = height - 40

  // Company Header
  page.drawText(companyConfig?.companyName || 'PAYROLL COMPANY', {
    x: 50, y: y, size: 20, font: titleFont, color: rgb(0.1, 0.1, 0.1)
  })

  y -= 30
  page.drawText('EMPLOYEE PAYSTUB', {
    x: width - 200, y: y, size: 16, font: titleFont, color: rgb(0.1, 0.1, 0.1)
  })

  // Employee Info
  y -= 50
  page.drawText(`Employee: ${paystub.employeeName}`, {
    x: 50, y: y, size: 12, font: bodyFont, color: rgb(0.1, 0.1, 0.1)
  })

  y -= 20
  page.drawText(`Pay Period: ${formatDate(paystub.weekStartDate)} - ${formatDate(paystub.weekEndDate)}`, {
    x: 50, y: y, size: 10, font: bodyFont, color: rgb(0.3, 0.3, 0.3)
  })

  // Earnings
  y -= 50
  page.drawText('EARNINGS', { x: 50, y: y, size: 14, font: titleFont, color: rgb(0.2, 0.2, 0.2) })
  
  y -= 25
  page.drawText('Base Pay', { x: 60, y: y, size: 10, font: bodyFont, color: rgb(0.1, 0.1, 0.1) })
  page.drawText(`$${paystub.basePay.toFixed(2)}`, { x: width - 100, y: y, size: 10, font: bodyFont, color: rgb(0.1, 0.1, 0.1) })

  if (paystub.bonusAmount > 0) {
    y -= 20
    page.drawText('Bonus', { x: 60, y: y, size: 10, font: bodyFont, color: rgb(0.1, 0.1, 0.1) })
    page.drawText(`$${paystub.bonusAmount.toFixed(2)}`, { x: width - 100, y: y, size: 10, font: bodyFont, color: rgb(0.1, 0.1, 0.1) })
  }

  // Gross Pay
  y -= 30
  page.drawText('GROSS PAY', { x: 60, y: y, size: 12, font: titleFont, color: rgb(0.1, 0.1, 0.1) })
  page.drawText(`$${paystub.grossPay.toFixed(2)}`, { x: width - 100, y: y, size: 12, font: titleFont, color: rgb(0.1, 0.1, 0.1) })

  // Deductions
  y -= 50
  page.drawText('DEDUCTIONS', { x: 50, y: y, size: 14, font: titleFont, color: rgb(0.2, 0.2, 0.2) })
  
  y -= 25
  if (paystub.fuelDeductions > 0) {
    page.drawText('Fuel Costs', { x: 60, y: y, size: 10, font: bodyFont, color: rgb(0.1, 0.1, 0.1) })
    page.drawText(`-$${paystub.fuelDeductions.toFixed(2)}`, { x: width - 100, y: y, size: 10, font: bodyFont, color: rgb(0.7, 0.1, 0.1) })
    y -= 20
  }

  // Total Deductions
  page.drawText('TOTAL DEDUCTIONS', { x: 60, y: y, size: 12, font: titleFont, color: rgb(0.1, 0.1, 0.1) })
  page.drawText(`-$${paystub.totalDeductions.toFixed(2)}`, { x: width - 100, y: y, size: 12, font: titleFont, color: rgb(0.7, 0.1, 0.1) })

  // Net Pay (highlighted)
  y -= 50
  page.drawRectangle({
    x: 50, y: y - 30, width: width - 100, height: 30,
    color: rgb(0.95, 0.98, 0.95), borderColor: rgb(0.2, 0.7, 0.2), borderWidth: 2
  })

  y -= 10
  page.drawText('NET PAY', { x: 60, y: y, size: 16, font: titleFont, color: rgb(0.1, 0.5, 0.1) })
  page.drawText(`$${paystub.netPay.toFixed(2)}`, { x: width - 150, y: y, size: 18, font: titleFont, color: rgb(0.1, 0.5, 0.1) })

  // Footer
  page.drawText('This is an official paystub. Please retain for your records.', {
    x: 50, y: 50, size: 8, font: bodyFont, color: rgb(0.5, 0.5, 0.5)
  })

  return await pdf.save()
}

function formatDate(dateString: string | null): string {
  if (!dateString) return 'N/A'
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric'
  })
}

function getCurrentWeekNumber(dateString: string): number {
  const date = new Date(dateString)
  const start = new Date(date.getFullYear(), 0, 1)
  const diff = date.getTime() - start.getTime()
  const oneWeek = 1000 * 60 * 60 * 24 * 7
  return Math.ceil(diff / oneWeek)
}