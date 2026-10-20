import { changedFields, withChanges } from '@app/shared/utils/changed-fields';

describe('changedFields', () => {
  const before = {
    description: 'old',
    enabled: true,
    environments: ['production', 'staging'],
    note: null
  };

  it('returns no field for a resubmit of the stored values', () => {
    expect(
      changedFields(before, {
        description: 'old',
        enabled: true,
        environments: ['production', 'staging'],
        note: null
      })
    ).toEqual([]);
  });

  it('returns only the fields whose value differs', () => {
    expect(
      changedFields(before, {
        description: 'new',
        enabled: true,
        environments: ['production', 'staging']
      })
    ).toEqual(['description']);
  });

  it('compares arrays item by item', () => {
    expect(changedFields(before, { environments: ['production'] })).toEqual([
      'environments'
    ]);
    expect(
      changedFields(before, { environments: ['staging', 'production'] })
    ).toEqual(['environments']);
  });

  it('treats null and a value as different', () => {
    expect(changedFields(before, { note: 'set' })).toEqual(['note']);
    expect(changedFields(before, { description: null })).toEqual([
      'description'
    ]);
  });

  it('skips a key whose value is undefined', () => {
    expect(changedFields(before, { description: undefined })).toEqual([]);
  });
});

describe('withChanges', () => {
  const before = { name: 'team-a', description: 'old', note: null };

  it('applies each defined key and keeps the other fields', () => {
    expect(withChanges(before, { name: 'team-b' })).toEqual({
      name: 'team-b',
      description: 'old',
      note: null
    });
  });

  it('applies null and skips undefined', () => {
    expect(withChanges(before, { description: null, name: undefined })).toEqual(
      { name: 'team-a', description: null, note: null }
    );
  });

  it('does not change the record', () => {
    withChanges(before, { name: 'team-b' });
    expect(before.name).toBe('team-a');
  });
});
