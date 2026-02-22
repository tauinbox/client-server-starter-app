import * as dotenv from 'dotenv';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { postgresConfig } from './postgres.config';
import { User } from './modules/users/entities/user.entity';

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

  const dataSource = new DataSource(postgresConfig());
  await dataSource.initialize();

  try {
    const userRepo = dataSource.getRepository(User);
    const existing = await userRepo.findOne({ where: { email } });

    if (existing) {
      console.log(`Admin user ${email} already exists, skipping`);
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const admin = userRepo.create({
      email,
      password: hashedPassword,
      firstName,
      lastName,
      isActive: true,
      isEmailVerified: true
    });

    await userRepo.save(admin);
    console.log(`Admin user ${email} created successfully`);
  } finally {
    await dataSource.destroy();
  }
}

seedAdmin().catch((err: unknown) => {
  console.error('Failed to seed admin:', err);
  process.exit(1);
});
