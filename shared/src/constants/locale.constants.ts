export const SUPPORTED_LOCALES = ['en', 'ru'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'en';

/**
 * Normalises an arbitrary input (e.g. an `Accept-Language` header value or a
 * client-supplied preference) to a supported locale, falling back to the
 * default. Only the primary subtag is considered (`ru-RU` → `ru`).
 */
export function normalizeLocale(input: string | null | undefined): SupportedLocale {
  if (!input) return DEFAULT_LOCALE;
  const primary = input.split(',')[0].trim().split('-')[0].toLowerCase();
  return (SUPPORTED_LOCALES as readonly string[]).includes(primary)
    ? (primary as SupportedLocale)
    : DEFAULT_LOCALE;
}
