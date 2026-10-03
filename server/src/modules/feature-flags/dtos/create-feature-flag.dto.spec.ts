import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  APP_ENVIRONMENTS,
  BILLING_PROVIDER_FLAGS
} from '@app/shared/constants';
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
    const body =
      metatype === CreateFeatureFlagDto
        ? { key: 'new-dashboard', environments }
        : { environments };
    return (await pipe.transform(body, {
      type: 'body',
      metatype
    })) as CreateFeatureFlagDto;
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

describe('CreateFeatureFlagDto key', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true
  });

  async function keyErrors(body: object): Promise<string[] | null> {
    return pipe
      .transform(body, { type: 'body', metatype: CreateFeatureFlagDto })
      .then(
        () => null,
        (e: unknown) =>
          ((e as BadRequestException).getResponse() as { message: string[] })
            .message
      );
  }

  it.each(BILLING_PROVIDER_FLAGS.map((p) => p.enabledFlagKey))(
    'accepts the billing kill-switch key %s',
    async (key) => {
      expect(await keyErrors({ key })).toBeNull();
    }
  );

  // The mock sends the same arrays: validation-error-envelope-parity.spec.ts.
  it.each([
    [
      'a malformed key',
      { key: 'Not A Key' },
      ['key must match /^[a-z0-9][a-z0-9-]*[a-z0-9]$/ regular expression']
    ],
    [
      'a one-character key',
      { key: 'a' },
      [
        'key must match /^[a-z0-9][a-z0-9-]*[a-z0-9]$/ regular expression',
        'key must be longer than or equal to 2 characters'
      ]
    ],
    [
      'no key',
      {},
      [
        'key must match /^[a-z0-9][a-z0-9-]*[a-z0-9]$/ regular expression',
        'key must be shorter than or equal to 100 characters',
        'key must be longer than or equal to 2 characters',
        'key must be a string'
      ]
    ]
  ])('reports every failed rule for %s', async (_case, body, expected) => {
    expect(await keyErrors(body)).toEqual(expected);
  });
});

describe('UpdateFeatureFlagDto key', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true
  });

  it('rejects a key, because a rename re-buckets every percentage rollout', async () => {
    const error = await pipe
      .transform(
        { key: 'new-dashboard-renamed', enabled: true },
        { type: 'body', metatype: UpdateFeatureFlagDto }
      )
      .then(
        () => null,
        (e: unknown) => e
      );
    expect(error).toBeInstanceOf(BadRequestException);
    expect(
      ((error as BadRequestException).getResponse() as { message: string[] })
        .message
    ).toEqual(['property key should not exist']);
  });

  it('accepts a body without a key', async () => {
    const dto = (await pipe.transform(
      { enabled: true },
      { type: 'body', metatype: UpdateFeatureFlagDto }
    )) as UpdateFeatureFlagDto;
    expect(dto.enabled).toBe(true);
  });
});
