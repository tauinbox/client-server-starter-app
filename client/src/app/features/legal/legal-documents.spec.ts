import {
  LEGAL_DOCUMENT_KINDS,
  LEGAL_DOCUMENTS,
  LEGAL_JURISDICTIONS,
  SUPPORTED_LOCALES,
  type LegalDocumentKind,
  type LegalJurisdiction,
  type SupportedLocale
} from '@app/shared/constants';
import type { LegalDocumentContent } from './models/legal-document';
import ruTermsRu from '../../../assets/legal/ru/terms.ru.json';
import ruTermsEn from '../../../assets/legal/ru/terms.en.json';
import ruPrivacyRu from '../../../assets/legal/ru/privacy.ru.json';
import ruPrivacyEn from '../../../assets/legal/ru/privacy.en.json';
import ruRefundRu from '../../../assets/legal/ru/refund.ru.json';
import ruRefundEn from '../../../assets/legal/ru/refund.en.json';
import ruContactsRu from '../../../assets/legal/ru/contacts.ru.json';
import ruContactsEn from '../../../assets/legal/ru/contacts.en.json';
import intlTermsRu from '../../../assets/legal/intl/terms.ru.json';
import intlTermsEn from '../../../assets/legal/intl/terms.en.json';
import intlPrivacyRu from '../../../assets/legal/intl/privacy.ru.json';
import intlPrivacyEn from '../../../assets/legal/intl/privacy.en.json';
import intlRefundRu from '../../../assets/legal/intl/refund.ru.json';
import intlRefundEn from '../../../assets/legal/intl/refund.en.json';
import intlContactsRu from '../../../assets/legal/intl/contacts.ru.json';
import intlContactsEn from '../../../assets/legal/intl/contacts.en.json';

// The type requires a file for each jurisdiction, kind and locale, so a
// missing file does not compile.
const FILES: Record<
  LegalJurisdiction,
  Record<LegalDocumentKind, Record<SupportedLocale, LegalDocumentContent>>
> = {
  ru: {
    terms: { ru: ruTermsRu, en: ruTermsEn },
    privacy: { ru: ruPrivacyRu, en: ruPrivacyEn },
    refund: { ru: ruRefundRu, en: ruRefundEn },
    contacts: { ru: ruContactsRu, en: ruContactsEn }
  },
  intl: {
    terms: { ru: intlTermsRu, en: intlTermsEn },
    privacy: { ru: intlPrivacyRu, en: intlPrivacyEn },
    refund: { ru: intlRefundRu, en: intlRefundEn },
    contacts: { ru: intlContactsRu, en: intlContactsEn }
  }
};

const CASES = LEGAL_JURISDICTIONS.flatMap((jurisdiction) =>
  LEGAL_DOCUMENT_KINDS.flatMap((kind) =>
    SUPPORTED_LOCALES.map((locale) => ({ jurisdiction, kind, locale }))
  )
);

describe('legal documents', () => {
  it.each(CASES)(
    '$jurisdiction/$kind.$locale carries the version of LEGAL_DOCUMENTS',
    ({ jurisdiction, kind, locale }) => {
      const { updatedAt } = FILES[jurisdiction][kind][locale];

      expect(updatedAt).toBe(LEGAL_DOCUMENTS[jurisdiction][kind].version);
    }
  );

  it.each(CASES)(
    '$jurisdiction/$kind.$locale has a title and no empty section',
    ({ jurisdiction, kind, locale }) => {
      const { title, sections } = FILES[jurisdiction][kind][locale];

      expect(title.trim()).not.toBe('');
      expect(sections.length).toBeGreaterThan(0);

      for (const { heading, paragraphs } of sections) {
        expect(heading.trim()).not.toBe('');
        expect(paragraphs.length).toBeGreaterThan(0);
        expect(paragraphs.every((p) => p.trim() !== '')).toBe(true);
      }
    }
  );

  it.each(
    LEGAL_JURISDICTIONS.flatMap((j) =>
      LEGAL_DOCUMENT_KINDS.map((k) => [j, k] as const)
    )
  )(
    '%s/%s has the same section count in both locales',
    (jurisdiction, kind) => {
      const { ru, en } = FILES[jurisdiction][kind];

      expect(ru.sections.length).toBe(en.sections.length);
    }
  );

  it('a published version names no placeholder of the seller details', () => {
    const published = CASES.filter(
      ({ jurisdiction, kind }) =>
        LEGAL_DOCUMENTS[jurisdiction][kind].status === 'published'
    );

    for (const { jurisdiction, kind, locale } of published) {
      const text = JSON.stringify(FILES[jurisdiction][kind][locale]);

      expect(text, `${jurisdiction}/${kind}.${locale}`).not.toMatch(
        /\[[A-ZА-ЯЁ][A-ZА-ЯЁ ,]+\]/
      );
    }
  });
});
