import { registerLocaleData } from '@angular/common';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

async function initLocale(): Promise<void> {
  const lang = navigator.language.split('-')[0].toLowerCase();
  if (lang === 'en') return; // en-US is built in, no registration needed
  try {
    const localeModule = await import(`@angular/common/locales/${lang}`);
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
