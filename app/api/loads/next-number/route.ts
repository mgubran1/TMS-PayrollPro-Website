import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

async function generateNextLoadNumber(): Promise<string> {
  // Get the latest load number with LD- prefix
  const latestLoad = await prisma.load.findFirst({
    where: {
      loadNumber: {
        startsWith: 'LD-'
      }
    },
    orderBy: {
      id: 'desc' // Use ID for reliable ordering
    },
    select: {
      loadNumber: true
    }
  })

  if (!latestLoad) {
    // First load ever
    return 'LD-1001'
  }

  // Extract number part and increment
  const numberPart = latestLoad.loadNumber.replace('LD-', '')
  const nextNumber = parseInt(numberPart) + 1
  
  // Ensure it doesn't go below 1001
  const finalNumber = Math.max(nextNumber, 1001)
  
  return `LD-${finalNumber}`
}

export async function GET() {
  try {
    const nextLoadNumber = await generateNextLoadNumber()
    
    return NextResponse.json({
      nextLoadNumber,
      success: true
    })
  } catch (error) {
    console.error('Error generating next load number:', error)
    return NextResponse.json(
      { error: 'Failed to generate next load number', success: false },
      { status: 500 }
    )
  }
}
