import { DATA_REGIONS, HOME_DATA_REGION } from '@app/shared/constants';
import { linkRegion } from './link-region';

describe('linkRegion', () => {
  it('reads a link with no region as the home region', () => {
    expect(linkRegion(undefined)).toBe(HOME_DATA_REGION);
  });

  it.each(DATA_REGIONS)('accepts the region %s of the code', (region) => {
    expect(linkRegion(region)).toBe(region);
  });

  it.each([['mars'], [''], [['intl', 'ru']], [null]])(
    'refuses %j, which is not a region of the code',
    (value) => {
      expect(linkRegion(value)).toBeNull();
    }
  );
});
