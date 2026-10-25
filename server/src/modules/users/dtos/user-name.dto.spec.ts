import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import { MAX_NAME_LENGTH } from '@app/shared/constants';
import { RegisterDto } from '../../auth/dtos/register.dto';
import { UpdateProfileDto } from '../../auth/dtos/update-profile.dto';
import { CreateUserDto } from './create-user.dto';
import { UpdateUserDto } from './update-user.dto';

// The pipe options of main.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true
});

const CREATE_BASE = {
  email: 'jane@example.com',
  password: 'Sunrise-Kettle-19'
};

const CASES: [string, Type<unknown>, Record<string, unknown>][] = [
  ['CreateUserDto', CreateUserDto, CREATE_BASE],
  ['RegisterDto', RegisterDto, CREATE_BASE],
  ['UpdateUserDto', UpdateUserDto, {}],
  ['UpdateProfileDto', UpdateProfileDto, {}]
];

describe.each(CASES)('%s name', (_label, metatype, base) => {
  const validate = (name: unknown): Promise<unknown> =>
    pipe.transform({ ...base, name }, { type: 'body', metatype });

  async function messagesOf(name: unknown): Promise<string[]> {
    const error = await validate(name).then(
      () => null,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(BadRequestException);
    return (
      (error as BadRequestException).getResponse() as { message: string[] }
    ).message;
  }

  it('trims the name', async () => {
    await expect(validate('  Jane Doe  ')).resolves.toMatchObject({
      name: 'Jane Doe'
    });
  });

  it('keeps a one-word name', async () => {
    await expect(validate('Madonna')).resolves.toMatchObject({
      name: 'Madonna'
    });
  });

  it.each(['', '   '])('refuses the name %j', async (name) => {
    expect(await messagesOf(name)).toEqual(['name should not be empty']);
  });

  it('refuses a name over the cap', async () => {
    expect(await messagesOf('x'.repeat(MAX_NAME_LENGTH + 1))).toEqual([
      `name must be shorter than or equal to ${MAX_NAME_LENGTH} characters`
    ]);
  });
});
