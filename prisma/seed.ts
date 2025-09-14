import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main(){
  // Clean up existing data
  console.log('🗑️ Cleaning up existing data...')
  await prisma.auditEntry.deleteMany()
  await prisma.percentageSnapshot.deleteMany()
  await prisma.attachment.deleteMany()
  await prisma.truckAttachment.deleteMany()
  await prisma.trailerAttachment.deleteMany()
  await prisma.truck.deleteMany()
  await prisma.trailer.deleteMany()
  await prisma.employee.deleteMany()

  console.log('✅ Database cleaned - ready for fresh data!')
  console.log('📊 Tables reset:')
  console.log('  • 0 Employees')
  console.log('  • 0 Trucks')
  console.log('  • 0 Trailers')
  console.log('')
  console.log('🎉 You can now add your own data through the web interface!')
  console.log('🌐 Start the server with: npm run dev')
  console.log('🔗 Visit: http://localhost:3000')
}

main().catch(e=>{ console.error(e); process.exit(1) }).finally(()=> prisma.$disconnect())