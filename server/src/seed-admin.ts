import type { DataSource } from 'typeorm';
import { localPasswordRefusal } from '@app/shared/utils/password-policy';
import { hashPassword } from './common/utils/password-hash';
import { lookupBreachedPassword } from './modules/auth/breached-password/pwned-range-lookup';
import { User } from './modules/users/entities/user.entity';
import { Role } from './modules/auth/entities/role.entity';

/**
 * A boot step of `run-boot-steps.ts`. The container entrypoint runs that file
 * under `set -e`, so an error here stops the API from starting; that contract
 * is what `seed-admin.spec.ts` pins.
 */
export async function seedAdmin(dataSource: DataSource): Promise<void> {
  const email = process.env['ADMIN_EMAIL'];
  const password = process.env['ADMIN_PASSWORD'];
  const name = process.env['ADMIN_NAME']?.trim() || 'Admin';

  if (!email || !password) {
    console.log('ADMIN_EMAIL or ADMIN_PASSWORD not set, skipping admin seed');

    return;
  }

  const userRepo = dataSource.getRepository(User);
  const roleRepo = dataSource.getRepository(Role);

  const existing = await userRepo.findOne({
    where: { email },
    relations: { roles: true }
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
    throw new Error('Admin role not found - ensure migrations have run first');
  }

  // The blocklist of the set-password routes. It warns and continues: an error
  // here stops the API from starting, and a weak seed password is a problem to
  // fix at leisure, while refusing to boot over it is an outage.
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

  if (localPasswordRefusal(password, { email, name })) {
    console.warn(
      'WARNING: ADMIN_PASSWORD is a common password, or it contains the ' +
        'admin name, email or the product name. The admin user is being ' +
        'created with it - change the password after the first sign-in ' +
        'and rotate the ADMIN_PASSWORD secret.'
    );
  }

  const { hash, version } = await hashPassword(password);
  const admin = userRepo.create({
    email,
    password: hash,
    passwordHashVersion: version,
    name,
    isActive: true,
    isEmailVerified: true,
    roles: [adminRole]
  });

  await userRepo.save(admin);
  console.log(`Admin user ${email} created with admin role`);
}
