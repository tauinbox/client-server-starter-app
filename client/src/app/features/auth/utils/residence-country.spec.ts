import { COUNTRY_CODES } from '@app/shared/constants';
import { countryOptions, presetResidenceCountry } from './residence-country';

describe('presetResidenceCountry', () => {
  it('takes the region of the first language that has one', () => {
    expect(presetResidenceCountry(['en', 'de-AT', 'fr-FR'])).toBe('AT');
  });

  it('names no country when no language has a region', () => {
    expect(presetResidenceCountry(['en', 'ru'])).toBe('');
  });

  it('skips a malformed tag and a numeric region', () => {
    expect(presetResidenceCountry(['not a tag', 'es-419', 'pt-BR'])).toBe('BR');
  });
});

describe('countryOptions', () => {
  it('offers every country once, named in the language', () => {
    const options = countryOptions('en');

    expect(options).toHaveLength(COUNTRY_CODES.length);
    expect(options.find(({ code }) => code === 'DE')?.name).toBe('Germany');
    expect(countryOptions('ru').find(({ code }) => code === 'DE')?.name).toBe(
      'Германия'
    );
  });

  it('sorts by the name in that language', () => {
    const names = countryOptions('en').map(({ name }) => name);

    expect(names.indexOf('Austria')).toBeLessThan(names.indexOf('Germany'));
    expect(names.indexOf('Germany')).toBeLessThan(names.indexOf('Zambia'));
  });
});
