import { TranslocoTestingModule } from '@jsverse/transloco';
import enBase from '../assets/i18n/en.json';
import enAuth from '../app/features/auth/i18n/en.json';
import enUsers from '../app/features/users/i18n/en.json';
import enAdmin from '../app/features/admin/i18n/en.json';

/**
 * Pre-configured TranslocoTestingModule that includes all feature translations.
 * Base translations are registered under 'en'.
 * Scoped translations are registered under 'scope/en' keys so that
 * components using *transloco="let t; scope: 'admin'" resolve correctly.
 * preloadLangs: true ensures all scoped translations are merged into 'en'
 * before any component renders.
 * availableLangs must include 'en' so that TranslocoService.translate()
 * treats 'en' as a language (not a scope).
 */
export const TranslocoTestingModuleWithLangs = TranslocoTestingModule.forRoot({
  langs: {
    en: enBase,
    ru: {},
    'auth/en': enAuth,
    'users/en': enUsers,
    'admin/en': enAdmin
  },
  translocoConfig: {
    availableLangs: ['en', 'ru'],
    defaultLang: 'en'
  },
  preloadLangs: true
});
