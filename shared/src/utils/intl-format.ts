/** The name of a country in `locale`, or the code when it has no name. */
export function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    // A malformed code makes `of` throw; show the code as it came.
    return code;
  }
}

/** A calendar day in UTC, as every billing boundary is stored. */
export function formatUtcDay(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeZone: 'UTC'
  }).format(new Date(iso));
}
