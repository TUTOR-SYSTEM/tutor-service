/**
 * Seed N test users into PostgreSQL. Usage:
 *   bun scripts/seed-users-bulk.ts
 * Optional:
 *   SEED_COUNT=50 (default 50)
 *   SEED_PASSWORD='Test@12345' (shared password, min 6 chars)
 *   SEED_EMAIL_DOMAIN=example.test (default example.test) → user001@example.test
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { createPrisma } from './lib/prisma';
import { hashData } from '../src/packages/helpers/hashingData.helper';

function generateUserCode(): string {
  return randomBytes(3).toString('hex').slice(0, 6).toUpperCase();
}

function padIndex(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

async function main(): Promise<void> {
  const count = Math.min(500, Math.max(1, Number(process.env.SEED_COUNT ?? '50') || 50));
  const plainPassword = process.env.SEED_PASSWORD ?? 'Test@12345';
  const domain = (process.env.SEED_EMAIL_DOMAIN ?? 'example.test').trim() || 'example.test';

  if (plainPassword.length < 6) {
    console.error('SEED_PASSWORD must be at least 6 characters.');
    process.exit(1);
  }

  const prisma = createPrisma();

  const width = String(count).length;
  const emails: string[] = [];
  const usernames: string[] = [];
  for (let i = 1; i <= count; i++) {
    const suffix = padIndex(i, width);
    emails.push(`seeduser${suffix}@${domain}`);
    usernames.push(`seeduser${suffix}`);
  }

  const existingRows = await prisma.user.findMany({
    where: { OR: [{ email: { in: emails } }, { username: { in: usernames } }] },
    select: { email: true, username: true },
  });

  const existingEmails = new Set(existingRows.map((r) => r.email.toLowerCase()));
  const existingUsernames = new Set(existingRows.map((r) => r.username.toLowerCase()));

  const toCreate: { email: string; username: string }[] = [];
  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    const username = usernames[i];
    if (
      !existingEmails.has(email.toLowerCase()) &&
      !existingUsernames.has(username.toLowerCase())
    ) {
      toCreate.push({ email, username });
    }
  }

  if (toCreate.length === 0) {
    console.log(`All ${count} slot(s) already used (email or username); nothing to insert.`);
    await prisma.$disconnect();
    return;
  }

  const hashedPassword = await hashData(plainPassword);
  const firstName = 'Seed';
  const lastName = 'User';

  for (const row of toCreate) {
    await prisma.user.create({
      data: {
      userCode: generateUserCode(),
      email: row.email,
      username: row.username,
      firstName,
      lastName,
      password: hashedPassword,
      isActive: true,
      role: 'STUDENT',
      },
    });
  }

  const skipped = count - toCreate.length;
  console.log(`Inserted ${toCreate.length} user(s); skipped ${skipped} (email or username already taken).`);
  console.log(`Email pattern: seeduser${padIndex(1, width)}@${domain} … seeduser${padIndex(count, width)}@${domain}`);
  console.log('Shared password: (value of SEED_PASSWORD env or default Test@12345)');
  await prisma.$disconnect();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
