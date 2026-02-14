import type { MatIconRegistry } from '@angular/material/icon';
import type { DomSanitizer } from '@angular/platform-browser';

const OAUTH_ICONS = ['google', 'facebook', 'vk'] as const;

export function registerOAuthIcons(
  iconRegistry: MatIconRegistry,
  sanitizer: DomSanitizer
): void {
  for (const icon of OAUTH_ICONS) {
    iconRegistry.addSvgIcon(
      icon,
      sanitizer.bypassSecurityTrustResourceUrl(`/assets/icons/${icon}.svg`)
    );
  }
}
