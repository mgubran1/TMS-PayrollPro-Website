import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const query = searchParams.get('q') || ''
    const type = searchParams.get('type') || 'all'
    const limit = parseInt(searchParams.get('limit') || '20')

    // Build where condition for search
    let whereCondition: any = {
      isActive: true
    }

    // Filter by type if specified
    if (type !== 'all') {
      whereCondition.type = type
    }

    // Search across multiple fields (SQLite compatible)
    if (query.trim()) {
      whereCondition.OR = [
        { name: { contains: query } },
        { contactPerson: { contains: query } },
        { city: { contains: query } },
        { state: { contains: query } },
        { phone: { contains: query } },
        { email: { contains: query } }
      ]
    }

    const customers = await prisma.addressBook.findMany({
      where: whereCondition,
      select: {
        id: true,
        name: true,
        type: true,
        address: true,
        city: true,
        state: true,
        zipCode: true,
        country: true,
        contactPerson: true,
        phone: true,
        email: true
      },
      orderBy: [
        { name: 'asc' }
      ],
      take: limit
    })

    return NextResponse.json({ customers })
  } catch (error) {
    console.error('Error searching address book:', error)
    return NextResponse.json(
      { error: 'Failed to search customers' },
      { status: 500 }
    )
  }
}
