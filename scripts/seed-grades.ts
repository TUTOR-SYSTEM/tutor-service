#!/usr/bin/env bun
import 'dotenv/config';
import { createPrisma } from './lib/prisma';

async function main(): Promise<void> {
  const prisma = createPrisma();

  for (let level = 1; level <= 12; level++) {
    const name = `Lớp ${level}`;

    const existing = await prisma.grade.findUnique({ where: { level }, select: { id: true } });
    if (existing) {
      console.log(`Skipped (already exists): ${name}`);
      continue;
    }

    await prisma.grade.create({ data: { name, level } });
    console.log(`Created: ${name}`);
  }

  await prisma.$disconnect();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
