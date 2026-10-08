import { parseIfMatchVersion } from '@app/shared/utils/if-match';

describe('parseIfMatchVersion', () => {
  it.each([
    ['1', 1],
    ['42', 42],
    ['"3"', 3],
    ['2147483647', 2_147_483_647]
  ])('should read %j as version %d', (header, expected) => {
    expect(parseIfMatchVersion(header)).toBe(expected);
  });

  it.each([undefined, ''])('should report %j as missing', (header) => {
    expect(parseIfMatchVersion(header)).toBe('missing');
  });

  it.each([
    '1abc',
    '1.5',
    '0',
    '01',
    '-1',
    '+1',
    '1e3',
    ' 1',
    '1 ',
    'abc',
    '""',
    '"1',
    '1"',
    '""1""',
    'W/"1"',
    '*',
    '2147483648',
    '99999999999999999999'
  ])('should report %j as invalid', (header) => {
    expect(parseIfMatchVersion(header)).toBe('invalid');
  });
});
