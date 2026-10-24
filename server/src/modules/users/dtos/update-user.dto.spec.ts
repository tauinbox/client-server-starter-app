import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpdateUserDto } from './update-user.dto';

// The step-up factors come from StepUpFactorsDto, so they keep its validators
// under the pipe options of main.ts.
describe('UpdateUserDto', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true
  });

  function validate(payload: unknown): Promise<unknown> {
    return pipe.transform(payload, { type: 'body', metatype: UpdateUserDto });
  }

  async function messagesOf(payload: unknown): Promise<string[]> {
    const error = await validate(payload).then(
      () => null,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(BadRequestException);
    return (
      (error as BadRequestException).getResponse() as { message: string[] }
    ).message;
  }

  it('accepts the step-up factors of the caller beside the record fields', async () => {
    await expect(
      validate({
        email: 'moved@example.com',
        isActive: true,
        currentPassword: 'CurrentPassword123',
        code: '123456'
      })
    ).resolves.toBeInstanceOf(UpdateUserDto);
  });

  it('validates the code as StepUpFactorsDto does', async () => {
    expect(await messagesOf({ code: '12' })).toEqual([
      'code must be longer than or equal to 6 characters'
    ]);
  });

  it('refuses a field it does not declare', async () => {
    expect(await messagesOf({ extra: 1 })).toEqual([
      'property extra should not exist'
    ]);
  });
});
