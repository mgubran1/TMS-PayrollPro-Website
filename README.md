# TMS PayrollPro Website

A Next.js application for managing payroll and employee data for transportation management systems.

## Prerequisites

1. **Node.js** (version 18 or higher)
   - Download from: https://nodejs.org/
   - Choose the LTS version for Windows
   - During installation, make sure to check "Add to PATH"

## Setup Instructions

### 1. Install Node.js
If Node.js is not installed:
1. Go to https://nodejs.org/
2. Download the Windows Installer (.msi) - LTS version
3. Run the installer and follow the instructions
4. Make sure to check "Add to PATH" during installation
5. Restart your command prompt/terminal

### 2. Install Dependencies
```bash
cd C:\Users\Rayan\Desktop\PayrollDev102\website
npm install
```

### 3. Set up Clerk Authentication
1. Go to https://clerk.com and create a free account
2. Create a new application
3. Go to API Keys in your Clerk dashboard
4. Copy the Publishable Key and Secret Key
5. Update `.env.local` file with your actual keys:
   ```
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_your_key_here
   CLERK_SECRET_KEY=sk_test_your_key_here
   ```

### 4. Initialize Database
```bash
# Generate Prisma client
npx prisma generate

# Create and migrate database
npx prisma migrate dev --name init

# Seed with sample data
npm run db:seed
```

### 5. Run the Application
```bash
npm run dev
```

The application will be available at: http://localhost:3000

## Features

- **Authentication**: Clerk-based authentication with roles (admin, manager, viewer)
- **Employee Management**: CRUD operations for employee data
- **Import/Export**: CSV and XLSX support
- **Percentage Tracking**: Historical tracking of driver/company percentages
- **Audit Trail**: Track all changes to employee data
- **Document Attachments**: File upload capability

## User Roles

- **Admin**: Full access (create, edit, delete, import/export)
- **Manager**: Create and edit access, import/export
- **Viewer**: Read-only access

## Troubleshooting

### Common Issues

1. **"npm is not recognized"**
   - Node.js is not installed or not in PATH
   - Reinstall Node.js and ensure "Add to PATH" is checked

2. **Clerk authentication errors**
   - Check that environment variables are set correctly
   - Ensure keys are from the correct Clerk application

3. **Database errors**
   - Run `npx prisma migrate dev` to create database
   - Run `npx prisma generate` to update client

4. **Port 3000 already in use**
   - Use `npm run dev -- -p 3001` to run on different port