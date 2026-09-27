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

function countryName(code: string, lang: string): string {
  try {
    return new Intl.DisplayNames([lang], { type: 'region' }).of(code) ?? code;
  } catch {
    // A malformed code makes `of` throw; show the code as it came.
    return code;
  }
}
