import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { DocumentType } from '@/lib/loads-types'
import { todayISO } from '@/utils/dates'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

// GET /api/loads/[id]/documents - Get all documents for a load
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
    
    // Check if load exists
    const load = await prisma.load.findUnique({
      where: { id: loadId },
      select: { id: true, loadNumber: true }
    })
    
    if (!load) {
      return NextResponse.json(
        { error: 'Load not found' },
        { status: 404 }
      )
    }
    
    const documents = await prisma.loadDocument.findMany({
      where: { loadId },
      orderBy: { uploadDate: 'desc' }
    })
    
    console.log(`Retrieved ${documents.length} documents for load: ${load.loadNumber}`)
    return NextResponse.json(documents)
    
  } catch (error) {
    console.error('Error fetching load documents:', error)
    return NextResponse.json(
      { error: 'Failed to fetch load documents' },
      { status: 500 }
    )
  }
}

// POST /api/loads/[id]/documents - Upload document to load
export async function POST(
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
    
    // Check if load exists
    const load = await prisma.load.findUnique({
      where: { id: loadId },
      select: { id: true, loadNumber: true }
    })
    
    if (!load) {
      return NextResponse.json(
        { error: 'Load not found' },
        { status: 404 }
      )
    }
    
    const formData = await req.formData()
    const file = formData.get('file') as File
    const documentType = formData.get('type') as DocumentType || 'OTHER'
    
    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      )
    }
    
    // Validate document type - Enhanced with all required types
    const validTypes: DocumentType[] = ['RATE_CONFIRMATION', 'BOL', 'POD', 'PO', 'LUMPER', 'OTHER']
    if (!validTypes.includes(documentType)) {
      return NextResponse.json(
        { error: 'Invalid document type. Valid types: Rate Confirmation, BOL, POD, PO Number, Lumper, Other' },
        { status: 400 }
      )
    }
    
    // Validate file type
    const allowedMimeTypes = [
      'application/pdf',
      'image/jpeg',
      'image/jpg', 
      'image/png',
      'image/gif',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ]
    
    if (!allowedMimeTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Allowed: PDF, images, Word documents, text files' },
        { status: 400 }
      )
    }
    
    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024 // 10MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File too large. Maximum size: 10MB' },
        { status: 400 }
      )
    }
    
    // Create upload directory
    const uploadDir = join(process.cwd(), 'uploads', 'loads', loadId.toString())
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true })
    }
    
    // Generate unique filename
    const timestamp = Date.now()
    const originalName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
    const fileName = `${timestamp}_${originalName}`
    const filePath = join(uploadDir, fileName)
    const relativePath = `uploads/loads/${loadId}/${fileName}`
    
    // Save file to disk
    const bytes = await file.arrayBuffer()
    await writeFile(filePath, Buffer.from(bytes))
    
    // Save document record to database
    const document = await prisma.loadDocument.create({
      data: {
        loadId,
        fileName: originalName,
        filePath: relativePath,
        type: documentType,
        fileSize: file.size,
        contentType: file.type,
        uploadDate: todayISO()
      }
    })
    
    console.log(`Uploaded document: ${originalName} for load: ${load.loadNumber}`)
    return NextResponse.json(document)
    
  } catch (error) {
    console.error('Error uploading document:', error)
    return NextResponse.json(
      { error: 'Failed to upload document' },
      { status: 500 }
    )
  }
}

// DELETE /api/loads/[id]/documents - Delete all documents for a load (bulk delete)
export async function DELETE(
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
    
    // Check if load exists
    const load = await prisma.load.findUnique({
      where: { id: loadId },
      select: { id: true, loadNumber: true }
    })
    
    if (!load) {
      return NextResponse.json(
        { error: 'Load not found' },
        { status: 404 }
      )
    }
    
    // Get all documents before deletion (for file cleanup)
    const documents = await prisma.loadDocument.findMany({
      where: { loadId },
      select: { filePath: true }
    })
    
    // Delete database records
    const result = await prisma.loadDocument.deleteMany({
      where: { loadId }
    })
    
    // TODO: Implement file system cleanup
    // Note: In production, you'd want to clean up the physical files too
    // For now, we're just deleting the database records
    
    console.log(`Deleted ${result.count} documents for load: ${load.loadNumber}`)
    return NextResponse.json({
      message: `Deleted ${result.count} documents`,
      count: result.count
    })
    
  } catch (error) {
    console.error('Error deleting documents:', error)
    return NextResponse.json(
      { error: 'Failed to delete documents' },
      { status: 500 }
    )
  }
}

