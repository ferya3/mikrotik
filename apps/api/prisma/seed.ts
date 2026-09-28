/**
 * Seeds the permission catalogue, the default roles and — on first run — a super admin.
 * Safe to run repeatedly: system roles are re-synchronised with src/common/rbac/permissions.ts.
 *
 *   ADMIN_USERNAME=admin ADMIN_PASSWORD='...' npm run prisma:seed -w apps/api
 *   echo 'password' | npx ts-node prisma/seed.ts      # password on stdin (used by setup-windows.ps1)
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { ALL_PERMISSIONS, DEFAULT_ROLES } from '../src/common/rbac/permissions';

const prisma = new PrismaClient();

/** Reads the admin password from piped stdin (keeps it off the command line / process list). */
async function passwordFromStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8').replace(/[\r\n]+$/, '');
  return text || undefined;
}

async function main() {
  for (const key of ALL_PERMISSIONS) {
    await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
  }
  const perms = new Map((await prisma.permission.findMany()).map((p) => [p.key, p.id]));

  for (const [name, def] of Object.entries(DEFAULT_ROLES)) {
    const role = await prisma.role.upsert({
      where: { name },
      update: { description: def.description, isSystem: true },
      create: { name, description: def.description, isSystem: true },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: def.permissions.map((p) => ({ roleId: role.id, permissionId: perms.get(p)! })),
    });
  }

  if ((await prisma.user.count()) === 0) {
    const username = process.env.ADMIN_USERNAME ?? 'admin';
    const password = process.env.ADMIN_PASSWORD || (await passwordFromStdin());
    if (!password || !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12,128}$/.test(password)) {
      throw new Error('Set ADMIN_PASSWORD (12+ chars, upper, lower, digit) to create the first super admin');
    }
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'super_admin' } });
    await prisma.user.create({
      data: {
        username,
        fullName: 'Super Admin',
        roleId: role.id,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }),
      },
    });
    console.log(`Created super admin "${username}". Enable 2FA after first login.`);
  }
  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
