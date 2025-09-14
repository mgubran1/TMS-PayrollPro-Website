import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

// GET /api/loads/[id]/pdf - Generate and download merged PDF for load
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const loadId = parseInt(params.id)
    
    if (isNaN(loadId)) {
      return NextResponse.json(
        { error: 'Invalid load ID' },
        { status: 400 }
      )
    }
    
    // Get load details
    const load = await prisma.load.findUnique({
      where: { id: loadId },
      include: {
        documents: {
          orderBy: [
            { type: 'asc' }, // Order by document type for consistent merge order
            { uploadDate: 'asc' }
          ]
        }
      }
    })
    
    if (!load) {
      return NextResponse.json(
        { error: 'Load not found' },
        { status: 404 }
      )
    }
    
    // Filter only PDF documents for merging
    const pdfDocuments = load.documents.filter(doc => 
      doc.contentType === 'application/pdf'
    )
    
    if (pdfDocuments.length === 0) {
      return NextResponse.json(
        { error: 'No PDF documents found for this load' },
        { status: 404 }
      )
    }
    
    console.log(`Merging ${pdfDocuments.length} PDFs for load ${load.loadNumber}`)
    
    // Create new PDF document
    const mergedPdf = await PDFDocument.create()
    
    // Add cover page with load details
    await addCoverPage(mergedPdf, load)
    
    // Define document type order for consistent merging
    const typeOrder = ['RATE_CONFIRMATION', 'BOL', 'POD', 'PO', 'LUMPER', 'OTHER']
    
    // Sort documents by type order, then by upload date
    const sortedDocuments = pdfDocuments.sort((a, b) => {
      const aIndex = typeOrder.indexOf(a.type)
      const bIndex = typeOrder.indexOf(b.type)
      
      if (aIndex !== bIndex) {
        return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex)
      }
      
      return new Date(a.uploadDate || '').getTime() - new Date(b.uploadDate || '').getTime()
    })
    
    // Merge each PDF document
    for (const document of sortedDocuments) {
      try {
        const filePath = join(process.cwd(), document.filePath)
        
        if (!existsSync(filePath)) {
          console.warn(`File not found: ${filePath}`)
          continue
        }
        
        const pdfBytes = await readFile(filePath)
        const pdf = await PDFDocument.load(pdfBytes)
        
        // Add separator page for each document type
        await addSeparatorPage(mergedPdf, document.type, document.fileName)
        
        // Copy all pages from the source PDF
        const pageIndices = pdf.getPageIndices()
        const pages = await mergedPdf.copyPages(pdf, pageIndices)
        
        pages.forEach((page) => {
          mergedPdf.addPage(page)
        })
        
        console.log(`Added ${pages.length} pages from ${document.fileName}`)
        
      } catch (error) {
        console.error(`Error processing document ${document.fileName}:`, error)
        // Continue with other documents even if one fails
      }
    }
    
    // Generate final PDF bytes
    const pdfBytes = await mergedPdf.save()
    
    // Generate filename using PO Number or Load Number
    const filename = load.poNumber 
      ? `${load.poNumber.replace(/[^a-zA-Z0-9-]/g, '_')}_Load_${load.loadNumber}.pdf`
      : `Load_${load.loadNumber}_Documents.pdf`
    
    console.log(`Generated merged PDF: ${filename} (${Math.round(pdfBytes.length / 1024)}KB)`)
    
    // Return PDF as downloadable response
    return new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': pdfBytes.length.toString()
      }
    })
    
  } catch (error) {
    console.error('Error generating merged PDF:', error)
    return NextResponse.json(
      { error: 'Failed to generate merged PDF' },
      { status: 500 }
    )
  }
}

// Add cover page with load details
async function addCoverPage(pdf: PDFDocument, load: any) {
  const page = pdf.addPage([612, 792]) // Standard letter size
  const { width, height } = page.getSize()
  
  // Load fonts
  const titleFont = await pdf.embedFont(StandardFonts.HelveticaBold)
  const bodyFont = await pdf.embedFont(StandardFonts.Helvetica)
  
  let y = height - 80
  
  // Title
  page.drawText('LOAD DOCUMENTS', {
    x: 50,
    y: y,
    size: 24,
    font: titleFont,
    color: rgb(0.1, 0.1, 0.1)
  })
  
  y -= 60
  
  // Load information
  const loadInfo = [
    { label: 'Load Number:', value: load.loadNumber },
    { label: 'PO Number:', value: load.poNumber || 'N/A' },
    { label: 'Customer:', value: load.customer },
    { label: 'Pickup:', value: load.pickUpLocation || 'N/A' },
    { label: 'Delivery:', value: load.dropLocation || 'N/A' },
    { label: 'Pickup Date:', value: load.pickUpDate || 'N/A' },
    { label: 'Delivery Date:', value: load.deliveryDate || 'N/A' },
    { label: 'Driver:', value: load.driverName || 'Unassigned' },
    { label: 'Gross Amount:', value: `$${load.grossAmount.toFixed(2)}` },
    { label: 'Status:', value: load.status }
  ]
  
  for (const info of loadInfo) {
    page.drawText(info.label, {
      x: 50,
      y: y,
      size: 12,
      font: titleFont,
      color: rgb(0.2, 0.2, 0.2)
    })
    
    page.drawText(info.value, {
      x: 200,
      y: y,
      size: 12,
      font: bodyFont,
      color: rgb(0.1, 0.1, 0.1)
    })
    
    y -= 25
  }
  
  // Add generation info
  y -= 40
  page.drawText(`Generated on: ${new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })}`, {
    x: 50,
    y: y,
    size: 10,
    font: bodyFont,
    color: rgb(0.5, 0.5, 0.5)
  })
  
  // Add footer
  page.drawText('This document contains all uploaded documents for this load.', {
    x: 50,
    y: 50,
    size: 10,
    font: bodyFont,
    color: rgb(0.5, 0.5, 0.5)
  })
}

// Add separator page for each document type
async function addSeparatorPage(pdf: PDFDocument, documentType: string, fileName: string) {
  const page = pdf.addPage([612, 792])
  const { width, height } = page.getSize()
  
  const titleFont = await pdf.embedFont(StandardFonts.HelveticaBold)
  const bodyFont = await pdf.embedFont(StandardFonts.Helvetica)
  
  // Document type names
  const typeNames: { [key: string]: string } = {
    'RATE_CONFIRMATION': 'Rate Confirmation',
    'BOL': 'Bill of Lading',
    'POD': 'Proof of Delivery',
    'PO': 'Purchase Order',
    'LUMPER': 'Lumper Receipt',
    'OTHER': 'Other Document'
  }
  
  const typeName = typeNames[documentType] || documentType
  
  // Draw separator line
  page.drawLine({
    start: { x: 50, y: height - 100 },
    end: { x: width - 50, y: height - 100 },
    thickness: 2,
    color: rgb(0.3, 0.3, 0.3)
  })
  
  // Document type title
  page.drawText(typeName.toUpperCase(), {
    x: 50,
    y: height - 140,
    size: 20,
    font: titleFont,
    color: rgb(0.1, 0.1, 0.1)
  })
  
  // File name
  page.drawText(`File: ${fileName}`, {
    x: 50,
    y: height - 170,
    size: 12,
    font: bodyFont,
    color: rgb(0.4, 0.4, 0.4)
  })
  
  // Draw separator line
  page.drawLine({
    start: { x: 50, y: height - 200 },
    end: { x: width - 50, y: height - 200 },
    thickness: 1,
    color: rgb(0.7, 0.7, 0.7)
  })
}