import { inject, Pipe, type PipeTransform } from '@angular/core';
import { LanguageService } from '@core/services/language.service';

export type LocalizedDateFormat = 'short' | 'medium' | 'mediumDate';

const FORMAT_OPTIONS: Record<LocalizedDateFormat, Intl.DateTimeFormatOptions> =
  {
    short: { dateStyle: 'short', timeStyle: 'short' },
    medium: { dateStyle: 'medium', timeStyle: 'medium' },
    mediumDate: { dateStyle: 'medium' }
  };

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(
  lang: string,
  format: LocalizedDateFormat,
  timeZone: string | undefined
): Intl.DateTimeFormat {
  const key = `${lang}|${format}|${timeZone ?? ''}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(lang, {
      ...FORMAT_OPTIONS[format],
      timeZone
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

/**
 * Formats a date in the active UI language. Intl rather than Angular's
 * DatePipe: LanguageService loads Angular locale data lazily, after it sets
 * the language, so DatePipe can ask for a locale that is not registered yet.
 * Impure because the result follows the language signal, not only the input.
 */
@Pipe({
  name: 'localizedDate',
  standalone: true,
  pure: false
})
export class LocalizedDatePipe implements PipeTransform {
  readonly #language = inject(LanguageService).language;

  transform(
    value: string | number | Date | null | undefined,
    format: LocalizedDateFormat,
    timeZone?: string
  ): string {
    if (value === null || value === undefined) return '';
    return formatterFor(this.#language(), format, timeZone).format(
      new Date(value)
    );
  }
}
