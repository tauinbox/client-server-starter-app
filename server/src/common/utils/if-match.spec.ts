import {
  ifMatchHolds,
  parseIfMatch,
  versionEtag
} from '@app/shared/utils/if-match';

describe('parseIfMatch', () => {
  it.each([
    ['"1"', [1]],
    ['"42"', [42]],
    ['"2147483647"', [2_147_483_647]],
    ['"3", "4"', [3, 4]],
    ['"3",  "4" ', [3, 4]],
    [', "5",,', [5]]
  ])('reads %j as the versions %j', (header, versions) => {
    expect(parseIfMatch(header)).toEqual({ any: false, versions });
  });

  it.each(['W/"1"', '"abc"', '"a,b"', '"0"', '"01"', '"2147483648"', '""'])(
    'reads %j as a valid list that holds no version',
    (header) => {
      expect(parseIfMatch(header)).toEqual({ any: false, versions: [] });
    }
  );

  it('reads * as any current version', () => {
    expect(parseIfMatch('*')).toEqual({ any: true });
    expect(parseIfMatch(' * ')).toEqual({ any: true });
  });

  it.each([undefined, '', '   '])('reports %j as missing', (header) => {
    expect(parseIfMatch(header)).toBe('missing');
  });

  it.each([
    '1',
    'abc',
    '"1',
    '1"',
    '"1" "2"',
    '"1";"2"',
    '*, "1"',
    ',',
    'W/1',
    'w/"1"'
  ])('reports %j as invalid syntax', (header) => {
    expect(parseIfMatch(header)).toBe('invalid');
  });
});

describe('ifMatchHolds', () => {
  it('holds for any version under *', () => {
    expect(ifMatchHolds({ any: true }, 7)).toBe(true);
  });

  it('holds only for a listed version', () => {
    const condition = { any: false, versions: [3, 4] } as const;
    expect(ifMatchHolds(condition, 4)).toBe(true);
    expect(ifMatchHolds(condition, 5)).toBe(false);
  });
});

describe('versionEtag', () => {
  it('is the strong tag that parseIfMatch reads back', () => {
    expect(parseIfMatch(versionEtag(9))).toEqual({ any: false, versions: [9] });
  });
});
