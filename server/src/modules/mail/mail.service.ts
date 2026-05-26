import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';
import * as Handlebars from 'handlebars';
import { DEFAULT_LOCALE, normalizeLocale } from '@app/shared/constants';
import type { SupportedLocale } from '@app/shared/constants';
import { maskEmail } from '../../common/utils/escape-html';
import { EMAIL_TEMPLATE_SOURCE } from './email.template';
import {
  EmailMessage,
  MAIL_APP_NAME,
  MAIL_FOOTER,
  mailMessages
} from './mail-content';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter;
  private readonly clientUrl: string;
  private readonly from: string;
  private readonly useConsole: boolean;
  private readonly template: Handlebars.TemplateDelegate;

  constructor(private configService: ConfigService) {
    const smtpHost = this.configService.get<string>('SMTP_HOST');
    this.clientUrl =
      this.configService.get<string>('CLIENT_URL') || 'http://localhost:4200';
    this.from =
      this.configService.get<string>('SMTP_FROM') || 'noreply@example.com';
    this.useConsole = !smtpHost;
    this.template = Handlebars.compile(EMAIL_TEMPLATE_SOURCE);

    if (smtpHost) {
      this.transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(
          this.configService.get<string>('SMTP_PORT') || '587',
          10
        ),
        auth: {
          user: this.configService.get<string>('SMTP_USER'),
          pass: this.configService.get<string>('SMTP_PASS')
        }
      });
    } else {
      this.transporter = nodemailer.createTransport({
        jsonTransport: true
      });
    }
  }

  isSmtpConfigured(): boolean {
    return !this.useConsole;
  }

  async verifySmtp(): Promise<void> {
    await this.transporter.verify();
  }

  async sendEmailVerification(
    email: string,
    rawToken: string,
    locale: string = DEFAULT_LOCALE
  ): Promise<void> {
    const loc = normalizeLocale(locale);
    const url = `${this.clientUrl}/verify-email?token=${rawToken}`;
    await this.send(email, mailMessages(loc).verification(url), loc);
  }

  async sendPasswordReset(
    email: string,
    rawToken: string,
    locale: string = DEFAULT_LOCALE
  ): Promise<void> {
    const loc = normalizeLocale(locale);
    const url = `${this.clientUrl}/reset-password?token=${rawToken}`;
    await this.send(email, mailMessages(loc).passwordReset(url), loc);
  }

  async sendEmailChangeConfirmation(
    newEmail: string,
    rawToken: string,
    locale: string = DEFAULT_LOCALE
  ): Promise<void> {
    const loc = normalizeLocale(locale);
    const url = `${this.clientUrl}/confirm-email-change?token=${rawToken}`;
    await this.send(newEmail, mailMessages(loc).emailChangeConfirm(url), loc);
  }

  /**
   * Notification sent to the OLD address when an email change is requested.
   * Intentionally contains no clickable action — an attacker who briefly
   * controls the OLD mailbox must not be able to silence the alert. Recovery
   * is via password change (which clears the pending request) and support.
   * The new address is masked to limit disclosure if the OLD mailbox is compromised.
   */
  async sendEmailChangeNotificationOld(
    oldEmail: string,
    newEmail: string,
    locale: string = DEFAULT_LOCALE
  ): Promise<void> {
    const loc = normalizeLocale(locale);
    const message = mailMessages(loc).emailChangeNotifyOld(maskEmail(newEmail));
    await this.send(oldEmail, message, loc);
  }

  async sendEmailChangeCompletedNotification(
    oldEmail: string,
    newEmail: string,
    locale: string = DEFAULT_LOCALE
  ): Promise<void> {
    const loc = normalizeLocale(locale);
    const message = mailMessages(loc).emailChangeCompleted(newEmail);
    await this.send(oldEmail, message, loc);
  }

  private renderHtml(message: EmailMessage, locale: SupportedLocale): string {
    return this.template({
      lang: locale,
      appName: MAIL_APP_NAME,
      subject: message.subject,
      heading: message.heading,
      paragraphs: message.paragraphs,
      button: message.button,
      footer: MAIL_FOOTER[locale]
    });
  }

  private async send(
    to: string,
    message: EmailMessage,
    locale: SupportedLocale
  ): Promise<void> {
    if (this.useConsole) {
      const link = message.button ? `\n  Link: ${message.button.url}` : '';
      this.logger.log(`[MAIL] To: ${to} | ${message.subject}${link}`);
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject: message.subject,
        html: this.renderHtml(message, locale)
      });
    } catch (error) {
      this.logger.error(`Failed to send "${message.subject}" to ${to}`, error);
    }
  }
}
