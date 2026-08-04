import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateActionDto } from './create-action.dto';

// The Add Action dialog leaves Description blank by default and omits the key,
// so a required description made the documented-optional field a hard 400.
describe('CreateActionDto', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true
  });

  async function validate(payload: unknown): Promise<unknown> {
    return pipe.transform(payload, {
      type: 'body',
      metatype: CreateActionDto
    });
  }

  it('accepts a payload with no description', async () => {
    await expect(
      validate({ name: 'publish', displayName: 'Publish' })
    ).resolves.toEqual({ name: 'publish', displayName: 'Publish' });
  });

  it('accepts an empty description, as the update DTO already does', async () => {
    await expect(
      validate({ name: 'publish', displayName: 'Publish', description: '' })
    ).resolves.toBeDefined();
  });

  it('still rejects a description longer than 500 characters', async () => {
    const error = await validate({
      name: 'publish',
      displayName: 'Publish',
      description: 'x'.repeat(501)
    }).then(
      () => null,
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(BadRequestException);
    const response = (error as BadRequestException).getResponse() as {
      message: string[];
    };
    expect(response.message.join(' ')).toContain(
      'description must be shorter than or equal to 500 characters'
    );
  });

  it('still rejects a non-string description', async () => {
    await expect(
      validate({ name: 'publish', displayName: 'Publish', description: 42 })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('normalizes the name without constraining its shape', async () => {
    await expect(
      validate({ name: '  Publish Post  ', displayName: 'P' })
    ).resolves.toEqual({ name: 'publish post', displayName: 'P' });
  });
});
