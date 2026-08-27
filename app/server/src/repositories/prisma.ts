import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export async function ensurePrismaConnected() {
  try { await prisma.$connect(); } catch {}
}
