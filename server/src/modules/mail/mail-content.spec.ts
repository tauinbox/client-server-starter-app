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

  it('provides a footer for every supported locale', () => {
    expect(MAIL_FOOTER.en).toBeTruthy();
    expect(MAIL_FOOTER.ru).toBeTruthy();
  });
});
