import * as dotenv from 'dotenv';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { BCRYPT_SALT_ROUNDS } from '@app/shared/constants';
import { postgresConfig } from './postgres.config';
import { lookupBreachedPassword } from './modules/auth/breached-password/pwned-range-lookup';
import { User } from './modules/users/entities/user.entity';
import { Role } from './modules/auth/entities/role.entity';

dotenv.config();

async function seedAdmin(): Promise<void> {
  const email = process.env['ADMIN_EMAIL'];
  const password = process.env['ADMIN_PASSWORD'];
  const firstName = process.env['ADMIN_FIRST_NAME'] ?? 'Admin';
  const lastName = process.env['ADMIN_LAST_NAME'] ?? 'User';

  if (!email || !password) {
    console.log('ADMIN_EMAIL or ADMIN_PASSWORD not set, skipping admin seed');
    return;
  }

  // The same blocklist the set-password routes apply. A seeded admin is the
  // account least able to afford a public password, and unlike a request this
  // runs once at deploy time, so refusing costs nothing that a corrected
  // ADMIN_PASSWORD does not fix.
  const breachOutcome = await lookupBreachedPassword(password, {
    rangeUrl: process.env['PWNED_PASSWORDS_RANGE_URL'],
    onUnavailable: (reason) =>
      console.warn(
        `Breached-password lookup ${reason} - ADMIN_PASSWORD seeded unchecked`
      )
  });
  if (breachOutcome === 'breached') {
    console.error(
      'ADMIN_PASSWORD appears in a public data breach - choose a different value'
    );
    process.exit(1);
  }

  const dataSource = new DataSource(postgresConfig());
  await dataSource.initialize();

  try {
    const userRepo = dataSource.getRepository(User);
    const roleRepo = dataSource.getRepository(Role);

    const existing = await userRepo.findOne({
      where: { email },
      relations: ['roles']
    });

    if (existing) {
      if (existing.roles.some((r) => r.name === 'admin')) {
        console.log(
          `Admin user ${email} already exists with admin role, skipping`
        );
        return;
      }
      const adminRole = await roleRepo.findOne({ where: { name: 'admin' } });
      if (adminRole) {
        existing.roles = [...existing.roles, adminRole];
        await userRepo.save(existing);
        console.log(`Admin role assigned to existing user ${email}`);
      }
      return;
    }

    const adminRole = await roleRepo.findOne({ where: { name: 'admin' } });
    if (!adminRole) {
      console.error('Admin role not found — ensure migrations have run first');
      process.exit(1);
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const admin = userRepo.create({
      email,
      password: hashedPassword,
      firstName,
      lastName,
      isActive: true,
      isEmailVerified: true,
      roles: [adminRole]
    });

    await userRepo.save(admin);
    console.log(`Admin user ${email} created with admin role`);
  } finally {
    await dataSource.destroy();
  }
}

seedAdmin().catch((err: unknown) => {
  console.error('Failed to seed admin:', err);
  process.exit(1);
});
