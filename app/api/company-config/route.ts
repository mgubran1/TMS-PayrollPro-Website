import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { todayISO } from '@/utils/dates';

// GET /api/company-config - Get active company configuration
export async function GET() {
  try {
    const config = await prisma.companyConfig.findFirst({
      where: { isActive: true }
    });

    if (!config) {
      return NextResponse.json(null, { status: 404 });
    }

    return NextResponse.json(config);
  } catch (error) {
    console.error('Error fetching company config:', error);
    return NextResponse.json(
      { error: 'Failed to fetch company configuration' },
      { status: 500 }
    );
  }
}

// POST /api/company-config - Create new company configuration
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    const {
      companyName,
      address,
      city,
      state,
      zipCode,
      country,
      phone,
      email,
      website,
      fax,
      mcNumber,
      dotNumber,
      taxId,
      logoUrl,
      primaryColor,
      secondaryColor,
      pdfHeaderText,
      pdfFooterText,
      includeTerms,
      defaultTerms,
      fromEmail,
      replyToEmail,
      emailSignature
    } = body;

    // Validate required fields
    if (!companyName) {
      return NextResponse.json(
        { error: 'Company name is required' },
        { status: 400 }
      );
    }

    // Deactivate any existing configurations
    await prisma.companyConfig.updateMany({
      where: { isActive: true },
      data: { isActive: false }
    });

    // Create new configuration
    const config = await prisma.companyConfig.create({
      data: {
        companyName: companyName.trim(),
        address: address?.trim() || null,
        city: city?.trim() || null,
        state: state?.trim() || null,
        zipCode: zipCode?.trim() || null,
        country: country?.trim() || 'USA',
        phone: phone?.trim() || null,
        email: email?.trim() || null,
        website: website?.trim() || null,
        fax: fax?.trim() || null,
        mcNumber: mcNumber?.trim() || null,
        dotNumber: dotNumber?.trim() || null,
        taxId: taxId?.trim() || null,
        logoUrl: logoUrl?.trim() || null,
        primaryColor: primaryColor || '#047857',
        secondaryColor: secondaryColor || '#64748b',
        pdfHeaderText: pdfHeaderText?.trim() || null,
        pdfFooterText: pdfFooterText?.trim() || null,
        includeTerms: includeTerms !== undefined ? includeTerms : true,
        defaultTerms: defaultTerms?.trim() || null,
        fromEmail: fromEmail?.trim() || null,
        replyToEmail: replyToEmail?.trim() || null,
        emailSignature: emailSignature?.trim() || null,
        isActive: true,
        createdDate: todayISO(),
        modifiedDate: todayISO(),
        modifiedBy: 'web-api'
      }
    });

    return NextResponse.json(config, { status: 201 });

  } catch (error) {
    console.error('Error creating company config:', error);
    return NextResponse.json(
      { error: 'Failed to create company configuration' },
      { status: 500 }
    );
  }
}

// PUT /api/company-config - Update company configuration
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, ...updateData } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Configuration ID is required' },
        { status: 400 }
      );
    }

    // Validate required fields
    if (updateData.companyName && !updateData.companyName.trim()) {
      return NextResponse.json(
        { error: 'Company name is required' },
        { status: 400 }
      );
    }

    // Check if config exists
    const existing = await prisma.companyConfig.findUnique({
      where: { id: parseInt(id) }
    });

    if (!existing) {
      return NextResponse.json(
        { error: 'Company configuration not found' },
        { status: 404 }
      );
    }

    const config = await prisma.companyConfig.update({
      where: { id: parseInt(id) },
      data: {
        ...updateData,
        companyName: updateData.companyName?.trim() || existing.companyName,
        address: updateData.address?.trim() || null,
        city: updateData.city?.trim() || null,
        state: updateData.state?.trim() || null,
        zipCode: updateData.zipCode?.trim() || null,
        country: updateData.country?.trim() || existing.country,
        phone: updateData.phone?.trim() || null,
        email: updateData.email?.trim() || null,
        website: updateData.website?.trim() || null,
        fax: updateData.fax?.trim() || null,
        mcNumber: updateData.mcNumber?.trim() || null,
        dotNumber: updateData.dotNumber?.trim() || null,
        taxId: updateData.taxId?.trim() || null,
        logoUrl: updateData.logoUrl?.trim() || null,
        primaryColor: updateData.primaryColor || existing.primaryColor,
        secondaryColor: updateData.secondaryColor || existing.secondaryColor,
        pdfHeaderText: updateData.pdfHeaderText?.trim() || null,
        pdfFooterText: updateData.pdfFooterText?.trim() || null,
        includeTerms: updateData.includeTerms !== undefined ? updateData.includeTerms : existing.includeTerms,
        defaultTerms: updateData.defaultTerms?.trim() || null,
        fromEmail: updateData.fromEmail?.trim() || null,
        replyToEmail: updateData.replyToEmail?.trim() || null,
        emailSignature: updateData.emailSignature?.trim() || null,
        modifiedDate: todayISO(),
        modifiedBy: 'web-api'
      }
    });

    return NextResponse.json(config);

  } catch (error) {
    console.error('Error updating company config:', error);
    return NextResponse.json(
      { error: 'Failed to update company configuration' },
      { status: 500 }
    );
  }
}

