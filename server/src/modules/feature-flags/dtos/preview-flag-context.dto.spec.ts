import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { PreviewFlagContextDto } from './preview-flag-context.dto';
import { UpdateFeatureFlagDto } from './update-feature-flag.dto';

// The preview body accepts an unsaved rule set. It must be validated with the
// same shape rules as the save path, so exercise both DTOs through the real
// ValidationPipe configured as in main.ts.
describe('PreviewFlagContextDto draft fields', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true
  });

  async function transform<T>(
    body: Record<string, unknown>,
    metatype: typeof PreviewFlagContextDto | typeof UpdateFeatureFlagDto
  ): Promise<T> {
    return (await pipe.transform(body, { type: 'body', metatype })) as T;
  }

  async function messagesFor(
    body: Record<string, unknown>,
    metatype:
      | typeof PreviewFlagContextDto
      | typeof UpdateFeatureFlagDto = PreviewFlagContextDto
  ): Promise<string> {
    const error = await transform(body, metatype).then(
      () => null,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(BadRequestException);
    const response = (error as BadRequestException).getResponse() as {
      message: string[];
    };
    return response.message.join(' ');
  }

  const validRule = {
    type: 'role',
    effect: 'include',
    payload: { type: 'role', roleNames: ['beta'] }
  };

  it('accepts an omitted rule set', async () => {
    const dto = await transform<PreviewFlagContextDto>(
      { roles: ['beta'] },
      PreviewFlagContextDto
    );
    expect(dto.rules).toBeUndefined();
  });

  it('accepts a role name as long as a role can be named', async () => {
    const dto = await transform<PreviewFlagContextDto>(
      { roles: ['r'.repeat(100)] },
      PreviewFlagContextDto
    );
    expect(dto.roles).toEqual(['r'.repeat(100)]);
  });

  it('rejects a role name longer than a role can be named', async () => {
    await expect(messagesFor({ roles: ['r'.repeat(101)] })).resolves.toBe(
      'each value in roles must be shorter than or equal to 100 characters'
    );
  });

  it('accepts a well-formed rule set', async () => {
    const dto = await transform<PreviewFlagContextDto>(
      { rules: [validRule] },
      PreviewFlagContextDto
    );
    expect(dto.rules).toHaveLength(1);
    expect(dto.rules?.[0].effect).toBe('include');
  });

  it('rejects a non-array rule set with the same message as the save path', async () => {
    const preview = await messagesFor({ rules: 'nope' });
    const save = await messagesFor({ rules: 'nope' }, UpdateFeatureFlagDto);
    expect(preview).toBe(save);
  });

  it('rejects an unknown rule effect with the same message as the save path', async () => {
    const bad = { ...validRule, effect: 'maybe' };
    const preview = await messagesFor({ rules: [bad] });
    const save = await messagesFor({ rules: [bad] }, UpdateFeatureFlagDto);
    expect(preview).toBe(save);
  });

  it('rejects more than 64 rules', async () => {
    const rules = Array.from({ length: 65 }, () => validRule);
    await expect(messagesFor({ rules })).resolves.toContain(
      'rules must contain no more than 64 elements'
    );
  });

  it('rejects a non-boolean enabled', async () => {
    await expect(messagesFor({ enabled: 'yes' })).resolves.toContain(
      'enabled must be a boolean value'
    );
  });

  it('rejects an env that no server can run as, like a save does', async () => {
    const preview = await messagesFor({ env: 'prod' });
    expect(preview).toBe(
      'env must be one of the following values: local, development, staging, production'
    );
    await expect(
      messagesFor({ environments: ['prod'] }, UpdateFeatureFlagDto)
    ).resolves.toContain('one of the following values');
  });

  it('accepts every deployable env', async () => {
    for (const env of ['local', 'development', 'staging', 'production']) {
      const dto = await transform<PreviewFlagContextDto>(
        { env },
        PreviewFlagContextDto
      );
      expect(dto.env).toBe(env);
    }
  });

  it('rejects a non-string env with the same single message', async () => {
    await expect(messagesFor({ env: 7 })).resolves.toBe(
      'env must be one of the following values: local, development, staging, production'
    );
  });

  it.each(['anon-42', 7])(
    'rejects the anonId %p, which the rollout cookie can never hold',
    async (anonId) => {
      await expect(messagesFor({ anonId })).resolves.toBe(
        'anonId must be a UUID'
      );
    }
  );

  // The rollout cookie accepts any UUID shape, with no RFC version or variant.
  it('accepts an anonId of the rollout cookie shape', async () => {
    const anonId = '11111111-1111-1111-1111-111111111111';
    const dto = await transform<PreviewFlagContextDto>(
      { anonId },
      PreviewFlagContextDto
    );
    expect(dto.anonId).toBe(anonId);
  });

  it('accepts 32 attribute keys of up to 64 characters', async () => {
    const attributes: Record<string, unknown> = { ['k'.repeat(64)]: 1 };
    for (let i = 1; i < 32; i++) attributes[`k${i}`] = i;
    const dto = await transform<PreviewFlagContextDto>(
      { attributes },
      PreviewFlagContextDto
    );
    expect(dto.attributes).toEqual(attributes);
  });

  it('rejects 33 attribute keys instead of dropping the extra one', async () => {
    const attributes: Record<string, unknown> = {};
    for (let i = 0; i < 33; i++) attributes[`k${i}`] = i;
    await expect(messagesFor({ attributes })).resolves.toBe(
      'attributes must contain no more than 32 keys'
    );
  });

  it('rejects an empty or over-long attribute key instead of dropping it', async () => {
    const message =
      'each key in attributes must be from 1 to 64 characters long';
    await expect(messagesFor({ attributes: { '': 1 } })).resolves.toBe(message);
    await expect(
      messagesFor({ attributes: { ['k'.repeat(65)]: 1 } })
    ).resolves.toBe(message);
  });

  it('normalizes and validates draft environments', async () => {
    const dto = await transform<PreviewFlagContextDto>(
      { environments: [' Production ', 'production'] },
      PreviewFlagContextDto
    );
    expect(dto.environments).toEqual(['production']);
    await expect(messagesFor({ environments: ['mars'] })).resolves.toContain(
      'each value in environments must be one of the following values'
    );
  });
});
