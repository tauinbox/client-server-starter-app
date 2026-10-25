import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpdateResourceDto } from './update-resource.dto';

// Pipe options mirror main.ts.
describe('UpdateResourceDto displayName', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true
  });

  function validate(body: object): Promise<unknown> {
    return pipe.transform(body, { type: 'body', metatype: UpdateResourceDto });
  }

  it.each([[''], ['   ']])('rejects %j', async (displayName) => {
    const error = await validate({ displayName }).then(
      () => null,
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(BadRequestException);
    expect(
      ((error as BadRequestException).getResponse() as { message: unknown })
        .message
    ).toEqual(['displayName should not be empty']);
  });

  it('trims a valid name', async () => {
    await expect(validate({ displayName: '  Users  ' })).resolves.toEqual(
      Object.assign(new UpdateResourceDto(), { displayName: 'Users' })
    );
  });

  it('accepts a body with no displayName', async () => {
    await expect(validate({ description: null })).resolves.toEqual(
      Object.assign(new UpdateResourceDto(), { description: null })
    );
  });
});
