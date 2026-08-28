import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { PreviewFlagContextDto } from './preview-flag-context.dto';
import { ReplaceRulesDto } from './replace-rules.dto';

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
    metatype: typeof PreviewFlagContextDto | typeof ReplaceRulesDto
  ): Promise<T> {
    return (await pipe.transform(body, { type: 'body', metatype })) as T;
  }

  async function messagesFor(
    body: Record<string, unknown>,
    metatype:
      | typeof PreviewFlagContextDto
      | typeof ReplaceRulesDto = PreviewFlagContextDto
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
    const save = await messagesFor({ rules: 'nope' }, ReplaceRulesDto);
    expect(preview).toBe(save);
  });

  it('rejects an unknown rule effect with the same message as the save path', async () => {
    const bad = { ...validRule, effect: 'maybe' };
    const preview = await messagesFor({ rules: [bad] });
    const save = await messagesFor({ rules: [bad] }, ReplaceRulesDto);
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
