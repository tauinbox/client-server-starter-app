import {
  COUNTRY_CODES,
  isCountryCode,
  type CountryCode
} from '@app/shared/constants';

export type CountryOption = {
  code: CountryCode;
  name: string;
};

/** Every country, named in `lang` and sorted by that name. */
export function countryOptions(lang: string): CountryOption[] {
  const names = new Intl.DisplayNames([lang], { type: 'region' });
  const collator = new Intl.Collator(lang);

  return COUNTRY_CODES.map((code) => ({
    code,
    name: names.of(code) ?? code
  })).toSorted((a, b) => collator.compare(a.name, b.name));
}

/**
 * The first explicit region of the browser languages (`de-AT` gives `AT`).
 * A language with no region names no country, so the user picks one.
 */
export function presetResidenceCountry(
  languages: readonly string[]
): CountryCode | '' {
  for (const language of languages) {
    let region: string | undefined;

    try {
      ({ region } = new Intl.Locale(language));
    } catch {
      // A malformed language tag names no country.
      continue;
    }

    if (isCountryCode(region)) return region;
  }

  return '';
}
