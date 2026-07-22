import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { APP_ENVIRONMENTS } from '@app/shared/constants';
import { CreateFeatureFlagDto } from './create-feature-flag.dto';
import { UpdateFeatureFlagDto } from './update-feature-flag.dto';

// Exercises the real request validation path with the same ValidationPipe
// options as main.ts.
describe('CreateFeatureFlagDto environments', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true
  });

  async function validate(
    environments: unknown,
    metatype:
      | typeof CreateFeatureFlagDto
      | typeof UpdateFeatureFlagDto = CreateFeatureFlagDto
  ): Promise<CreateFeatureFlagDto> {
    return (await pipe.transform(
      { key: 'new-dashboard', environments },
      { type: 'body', metatype }
    )) as CreateFeatureFlagDto;
  }

  async function expectRejected(environments: unknown): Promise<string> {
    const error = await validate(environments).then(
      () => null,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(BadRequestException);
    const response = (error as BadRequestException).getResponse() as {
      message: string[];
    };
    return response.message.join(' ');
  }

  it('trims, lowercases and de-duplicates while preserving order', async () => {
    const dto = await validate([
      ' Production ',
      'STAGING',
      'production',
      'staging'
    ]);
    expect(dto.environments).toEqual(['production', 'staging']);
  });

  it('accepts every deployable environment name', async () => {
    const dto = await validate([...APP_ENVIRONMENTS]);
    expect(dto.environments).toEqual([...APP_ENVIRONMENTS]);
  });

  it('rejects a name the server can never run as', async () => {
    // Pre-fix this was stored happily and silently disabled the flag everywhere.
    expect(await expectRejected(['qa'])).toContain('environments');
  });

  it('rejects non-string entries', async () => {
    expect(await expectRejected([42])).toContain('environments');
  });

  it('applies the same rules on update', async () => {
    const dto = await validate([' Local '], UpdateFeatureFlagDto);
    expect(dto.environments).toEqual(['local']);

    const error = await validate(['qa'], UpdateFeatureFlagDto).then(
      () => null,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(BadRequestException);
  });

  it('leaves an omitted list undefined', async () => {
    const dto = (await pipe.transform(
      { key: 'new-dashboard' },
      { type: 'body', metatype: CreateFeatureFlagDto }
    )) as CreateFeatureFlagDto;
    expect(dto.environments).toBeUndefined();
  });
});
