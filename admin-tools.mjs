import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();
const [, , command, ...args] = process.argv;

async function listAllUsers() {
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
  console.log(`\n--- PET-HAVEN USER REGISTRY (${users.length}) ---`);
  for (const u of users) {
    console.log(`[${u.role.toUpperCase()}] ${u.email.padEnd(30)} | ID: ${u.id}`);
  }
}

async function promoteToBreeder(email, businessName) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) return console.error('User not found.');
  await prisma.user.update({
    where: { id: user.id },
    data: { role: 'vendor', businessName }
  });
  console.log(`🐾 SUCCESS: ${user.fullName} is now a registered breeder: "${businessName}"`);
}

async function createPetCoupon(code, type, value, minOrder) {
  const coupon = await prisma.coupon.create({
    data: {
      code: code.trim().toUpperCase(),
      discountType: type === 'percent' ? 'PERCENT' : 'FIXED',
      discountValue: parseInt(value),
      minOrderAmount: parseInt(minOrder) || 0
    }
  });
  console.log(`🎁 Coupon ${coupon.code} created successfully.`);
}

async function main() {
  switch (command) {
    case 'list-users': return listAllUsers();
    case 'make-breeder': return promoteToBreeder(args[0], args[1]);
    case 'create-coupon': return createPetCoupon(args[0], args[1], args[2], args[3]);
    default:
      console.log('\n🐾 PetHaven CLI Tools');
      console.log('Usage: node admin-tools.mjs <command>');
      console.log('  list-users');
      console.log('  make-breeder <email> "<Shop Name>"');
      console.log('  create-coupon <CODE> <percent/fixed> <value> [minOrder]');
  }
}

main().finally(() => prisma.$disconnect());