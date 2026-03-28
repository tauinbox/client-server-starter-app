import { registerLocaleData } from '@angular/common';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

const LANGUAGE_KEY = 'preferred-language';

async function initLocale(): Promise<void> {
  const saved = localStorage.getItem(LANGUAGE_KEY);
  const lang = saved || navigator.language.split('-')[0].toLowerCase();
  if (lang === 'en') return;
  try {
    const localeModule = await import(
      /* @vite-ignore */ `@angular/common/locales/${lang}`
    );
    registerLocaleData(localeModule.default);
  } catch {
    // Unknown locale — fall back to built-in en-US
  }
}

initLocale().then(() =>
  bootstrapApplication(AppComponent, appConfig).catch((err) =>
    console.error(err)
  )
);
