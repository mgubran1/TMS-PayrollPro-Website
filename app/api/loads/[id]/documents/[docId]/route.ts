import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { unlink } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

// GET /api/loads/[id]/documents/[docId] - Get specific document
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string, docId: string } }
) {
  try {
    const loadId = parseInt(params.id)
    const docId = parseInt(params.docId)
    
    if (isNaN(loadId) || isNaN(docId)) {
      return NextResponse.json(
        { error: 'Invalid ID' },
        { status: 400 }
      )
    }
    
    const document = await prisma.loadDocument.findFirst({
      where: { 
        id: docId,
        loadId
      }
    })
    
    if (!document) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json(document)
    
  } catch (error) {
    console.error('Error fetching document:', error)
    return NextResponse.json(
      { error: 'Failed to fetch document' },
      { status: 500 }
    )
  }
}

// DELETE /api/loads/[id]/documents/[docId] - Delete specific document
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string, docId: string } }
) {
  try {
    const loadId = parseInt(params.id)
    const docId = parseInt(params.docId)
    
    if (isNaN(loadId) || isNaN(docId)) {
      return NextResponse.json(
        { error: 'Invalid ID' },
        { status: 400 }
      )
    }
    
    // Get document info before deletion
    const document = await prisma.loadDocument.findFirst({
      where: { 
        id: docId,
        loadId
      },
      include: {
        load: {
          select: { loadNumber: true }
        }
      }
    })
    
    if (!document) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      )
    }
    
    // Delete from database
    await prisma.loadDocument.delete({
      where: { id: docId }
    })
    
    // Delete physical file
    try {
      const fullFilePath = join(process.cwd(), document.filePath)
      if (existsSync(fullFilePath)) {
        await unlink(fullFilePath)
        console.log(`Deleted file: ${document.filePath}`)
      }
    } catch (fileError) {
      console.warn(`Failed to delete file: ${document.filePath}`, fileError)
      // Continue - we still deleted the database record
    }
    
    console.log(`Deleted document: ${document.fileName} for load: ${document.load.loadNumber}`)
    return NextResponse.json({
      message: 'Document deleted successfully',
      fileName: document.fileName
    })
    
  } catch (error) {
    console.error('Error deleting document:', error)
    return NextResponse.json(
      { error: 'Failed to delete document' },
      { status: 500 }
    )
  }
}

