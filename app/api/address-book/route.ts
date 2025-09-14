import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { todayISO } from '@/utils/dates';

// GET /api/address-book - Get all address book entries with search and filtering
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') || '';
    const type = searchParams.get('type') || 'all'; // customer, broker, shipper, all
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    
    const whereCondition: any = {};
    
    // Search filter
    if (search) {
      whereCondition.OR = [
        { name: { contains: search } },
        { address: { contains: search } },
        { city: { contains: search } },
        { state: { contains: search } },
        { zipCode: { contains: search } },
        { contactPerson: { contains: search } }
      ];
    }
    
    // Type filter
    if (type !== 'all') {
      whereCondition.type = type.toUpperCase();
    }
    
    const [entries, total] = await Promise.all([
      prisma.addressBook.findMany({
        where: whereCondition,
        orderBy: [
          { type: 'asc' },
          { name: 'asc' }
        ],
        take: limit,
        skip: offset
      }),
      prisma.addressBook.count({ where: whereCondition })
    ]);

    return NextResponse.json({
      entries,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      }
    });

  } catch (error) {
    console.error('Error fetching address book:', error);
    return NextResponse.json(
      { error: 'Failed to fetch address book entries' },
      { status: 500 }
    );
  }
}

// POST /api/address-book - Create new address book entry
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    const {
      name,
      type,
      address,
      city,
      state,
      zipCode,
      country,
      contactPerson,
      phone,
      email,
      fax,
      notes,
      isActive
    } = body;

    // Validate required fields
    if (!name || !type) {
      return NextResponse.json(
        { error: 'Name and type are required' },
        { status: 400 }
      );
    }

    // Check for duplicate name within same type
    const existing = await prisma.addressBook.findFirst({
      where: {
        name: name.trim(),
        type: type.toUpperCase()
      }
    });

    if (existing) {
      return NextResponse.json(
        { error: `${type} with name "${name}" already exists` },
        { status: 409 }
      );
    }

    const entry = await prisma.addressBook.create({
      data: {
        name: name.trim(),
        type: type.toUpperCase(),
        address: address?.trim() || null,
        city: city?.trim() || null,
        state: state?.trim() || null,
        zipCode: zipCode?.trim() || null,
        country: country?.trim() || 'USA',
        contactPerson: contactPerson?.trim() || null,
        phone: phone?.trim() || null,
        email: email?.trim() || null,
        fax: fax?.trim() || null,
        notes: notes?.trim() || null,
        isActive: isActive !== undefined ? isActive : true,
        createdDate: todayISO(),
        modifiedDate: todayISO(),
        modifiedBy: 'web-api'
      }
    });

    return NextResponse.json(entry, { status: 201 });

  } catch (error) {
    console.error('Error creating address book entry:', error);
    return NextResponse.json(
      { error: 'Failed to create address book entry' },
      { status: 500 }
    );
  }
}

// PUT /api/address-book - Update address book entry
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, ...updateData } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Entry ID is required' },
        { status: 400 }
      );
    }

    // Check if entry exists
    const existing = await prisma.addressBook.findUnique({
      where: { id: parseInt(id) }
    });

    if (!existing) {
      return NextResponse.json(
        { error: 'Address book entry not found' },
        { status: 404 }
      );
    }

    // Check for duplicate name if name is being changed
    if (updateData.name && updateData.name !== existing.name) {
      const duplicate = await prisma.addressBook.findFirst({
        where: {
          name: updateData.name.trim(),
          type: updateData.type || existing.type,
          id: { not: parseInt(id) }
        }
      });

      if (duplicate) {
        return NextResponse.json(
          { error: `${updateData.type || existing.type} with name "${updateData.name}" already exists` },
          { status: 409 }
        );
      }
    }

    const updated = await prisma.addressBook.update({
      where: { id: parseInt(id) },
      data: {
        ...updateData,
        name: updateData.name?.trim(),
        type: updateData.type?.toUpperCase(),
        address: updateData.address?.trim() || null,
        city: updateData.city?.trim() || null,
        state: updateData.state?.trim() || null,
        zipCode: updateData.zipCode?.trim() || null,
        country: updateData.country?.trim() || existing.country,
        contactPerson: updateData.contactPerson?.trim() || null,
        phone: updateData.phone?.trim() || null,
        email: updateData.email?.trim() || null,
        fax: updateData.fax?.trim() || null,
        notes: updateData.notes?.trim() || null,
        modifiedDate: todayISO(),
        modifiedBy: 'web-api'
      }
    });

    return NextResponse.json(updated);

  } catch (error) {
    console.error('Error updating address book entry:', error);
    return NextResponse.json(
      { error: 'Failed to update address book entry' },
      { status: 500 }
    );
  }
}

// DELETE /api/address-book - Delete address book entry
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Entry ID is required' },
        { status: 400 }
      );
    }

    // Check if entry exists
    const existing = await prisma.addressBook.findUnique({
      where: { id: parseInt(id) }
    });

    if (!existing) {
      return NextResponse.json(
        { error: 'Address book entry not found' },
        { status: 404 }
      );
    }

    await prisma.addressBook.delete({
      where: { id: parseInt(id) }
    });

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error deleting address book entry:', error);
    return NextResponse.json(
      { error: 'Failed to delete address book entry' },
      { status: 500 }
    );
  }
}