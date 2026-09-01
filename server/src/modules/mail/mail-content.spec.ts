import { mailMessages, MAIL_FOOTER } from './mail-content';

describe('mail-content', () => {
  const url = 'https://app.example.com/verify-email?token=abc';

  it('returns English copy for the en locale', () => {
    const msg = mailMessages('en').verification(url);
    expect(msg.subject).toBe('Verify your email address');
    expect(msg.heading).toBe('Verify your email');
    expect(msg.button?.url).toBe(url);
    expect(msg.button?.label).toBe('Verify email');
  });

  it('returns Russian copy for the ru locale', () => {
    const msg = mailMessages('ru').verification(url);
    expect(msg.subject).toBe('Подтвердите адрес электронной почты');
    expect(msg.button?.url).toBe(url);
    // Subject differs from the English variant
    expect(msg.subject).not.toBe(mailMessages('en').verification(url).subject);
  });

  it('embeds the masked address in the old-address alert without a button', () => {
    const msg = mailMessages('en').emailChangeNotifyOld('n***@example.com');
    expect(msg.button).toBeUndefined();
    expect(msg.paragraphs.join(' ')).toContain('n***@example.com');
  });

  // A credential-change notice may reach the mailbox of an attacker, so it
  // carries no action link of any kind.
  it('carries no action link in any credential-change notice', () => {
    const details = { when: '2026-09-01 12:34 UTC', ip: '198.51.100.7' };
    for (const locale of ['en', 'ru'] as const) {
      expect(
        mailMessages(locale).passwordChanged('self', details).button
      ).toBeUndefined();
      expect(
        mailMessages(locale).oauthLinked('google', details).button
      ).toBeUndefined();
      expect(
        mailMessages(locale).oauthUnlinked('google', details).button
      ).toBeUndefined();
    }
  });

  it('names the source of a password change', () => {
    const details = { when: '2026-09-01 12:34 UTC' };
    const self = mailMessages('en').passwordChanged('self', details);
    const admin = mailMessages('en').passwordChanged('admin', details);
    const reset = mailMessages('en').passwordChanged('reset', details);

    expect(self.paragraphs[0]).toContain('profile page');
    expect(admin.paragraphs[0]).toContain('administrator');
    expect(reset.paragraphs[0]).toContain('password-reset link');
    expect(
      mailMessages('ru').passwordChanged('admin', details).subject
    ).not.toBe(admin.subject);
  });

  it('shows the time always and the IP address only when it is known', () => {
    const withIp = mailMessages('en').passwordChanged('self', {
      when: '2026-09-01 12:34 UTC',
      ip: '198.51.100.7'
    });
    const withoutIp = mailMessages('en').passwordChanged('self', {
      when: '2026-09-01 12:34 UTC'
    });

    expect(withIp.paragraphs.join(' ')).toContain('198.51.100.7');
    expect(withIp.paragraphs.join(' ')).toContain('2026-09-01 12:34 UTC');
    expect(withoutIp.paragraphs.join(' ')).toContain('2026-09-01 12:34 UTC');
    expect(withoutIp.paragraphs.join(' ')).not.toContain('IP');
  });

  it('names the provider in the link and unlink notices', () => {
    const details = { when: '2026-09-01 12:34 UTC' };

    expect(
      mailMessages('en').oauthLinked('vk', details).paragraphs[0]
    ).toContain('VK');
    expect(
      mailMessages('ru').oauthUnlinked('google', details).paragraphs[0]
    ).toContain('Google');
    // An unknown provider still renders, under its raw name.
    expect(
      mailMessages('en').oauthLinked('apple', details).paragraphs[0]
    ).toContain('apple');
  });

  it('provides a footer for every supported locale', () => {
    expect(MAIL_FOOTER.en).toBeTruthy();
    expect(MAIL_FOOTER.ru).toBeTruthy();
  });
});
