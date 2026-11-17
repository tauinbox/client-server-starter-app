import { countryName } from '@app/shared/utils/intl-format';

/**
 * "City, Country" for a session, with the country named in the UI language.
 * The server stores the city in English only. Null when both are unknown.
 */
export function describeLocation(
  countryCode: string | null,
  city: string | null,
  lang: string
): string | null {
  const country = countryCode ? countryName(countryCode, lang) : null;
  const parts = [city, country].filter((part): part is string => !!part);

  return parts.length > 0 ? parts.join(', ') : null;
}
