import * as dotenv from 'dotenv';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import {
  BCRYPT_SALT_ROUNDS,
  MAX_NEW_PASSWORD_BYTES
} from '@app/shared/constants';
import { exceedsPasswordByteLimit } from '@app/shared/utils/password-bytes';
import { postgresConfig } from './postgres.config';
import { lookupBreachedPassword } from './modules/auth/breached-password/pwned-range-lookup';
import { User } from './modules/users/entities/user.entity';
import { Role } from './modules/auth/entities/role.entity';

dotenv.config();

/**
 * Exported so a spec can drive it. The container entrypoint runs this file
 * under `set -e`, so anything that exits non-zero here stops the API from
 * starting; that contract is what `seed-admin.spec.ts` pins.
 */
export async function seedAdmin(): Promise<void> {
  const email = process.env['ADMIN_EMAIL'];
  const password = process.env['ADMIN_PASSWORD'];
  const firstName = process.env['ADMIN_FIRST_NAME'] ?? 'Admin';
  const lastName = process.env['ADMIN_LAST_NAME'] ?? 'User';

  if (!email || !password) {
    console.log('ADMIN_EMAIL or ADMIN_PASSWORD not set, skipping admin seed');
    return;
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

    // The same blocklist the set-password routes apply, and only on the branch
    // that actually sets a password. It WARNS and continues: this script runs
    // from the container entrypoint under `set -e`, so a non-zero exit here
    // stops the API from starting at all. A weak seed password is a problem to
    // fix at leisure; refusing to boot over it is an outage.
    const breachOutcome = await lookupBreachedPassword(password, {
      rangeUrl: process.env['PWNED_PASSWORDS_RANGE_URL'],
      onUnavailable: (reason) =>
        console.warn(
          `Breached-password lookup ${reason} - ADMIN_PASSWORD seeded unchecked`
        )
    });
    if (breachOutcome === 'breached') {
      console.warn(
        'WARNING: ADMIN_PASSWORD appears in a public data breach. The admin ' +
          'user is being created with it - change the password after the ' +
          'first sign-in and rotate the ADMIN_PASSWORD secret.'
      );
    }

    // The set-password routes reject an over-long value; this one only warns,
    // for the same reason the breach check above only warns. A truncated admin
    // password is a problem to fix at leisure. Refusing to boot over it is an
    // outage.
    if (exceedsPasswordByteLimit(password)) {
      console.warn(
        `WARNING: ADMIN_PASSWORD is longer than ${MAX_NEW_PASSWORD_BYTES} ` +
          'bytes. bcrypt ignores every byte past that point, so the tail is ' +
          'not part of the stored credential - shorten the secret.'
      );
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

if (require.main === module) {
  seedAdmin().catch((err: unknown) => {
    console.error('Failed to seed admin:', err);
    process.exit(1);
  });
}
