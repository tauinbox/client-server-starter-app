import type { TranslocoService } from '@jsverse/transloco';

export type CatalogKind = 'plans' | 'products';
export type CatalogField = 'name' | 'description';
export type CatalogItem = {
  key: string;
  name: string;
  description: string | null;
};

/**
 * The display text of a plan or product: the translation under
 * `billing.catalog.<kind>.<key>.<field>` when one exists, else the text from
 * the database. Plans and products that an admin adds have no translation, so
 * they show the database text. The key is looked up before `translate()`,
 * because a missing key makes Transloco log a warning in dev mode.
 */
export function catalogText(
  transloco: TranslocoService,
  kind: CatalogKind,
  item: CatalogItem,
  field: CatalogField
): string {
  const key = `billing.catalog.${kind}.${item.key}.${field}`;
  const translation = transloco.getTranslation(transloco.getActiveLang());
  return key in translation ? transloco.translate(key) : (item[field] ?? '');
}
