import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';
import { escapeHtml, maskEmail } from '../../common/utils/escape-html';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter;
  private readonly clientUrl: string;
  private readonly from: string;
  private readonly useConsole: boolean;

  constructor(private configService: ConfigService) {
    const smtpHost = this.configService.get<string>('SMTP_HOST');
    this.clientUrl =
      this.configService.get<string>('CLIENT_URL') || 'http://localhost:4200';
    this.from =
      this.configService.get<string>('SMTP_FROM') || 'noreply@example.com';
    this.useConsole = !smtpHost;

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

  async sendEmailVerification(email: string, rawToken: string): Promise<void> {
    const verifyUrl = `${this.clientUrl}/verify-email?token=${rawToken}`;
    const safeUrl = escapeHtml(verifyUrl);

    if (this.useConsole) {
      this.logger.log(
        `[EMAIL VERIFICATION] To: ${email}\n  Verify URL: ${verifyUrl}`
      );
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: email,
        subject: 'Verify your email address',
        html: `
          <h2>Email Verification</h2>
          <p>Please click the link below to verify your email address:</p>
          <p><a href="${safeUrl}">Verify Email</a></p>
          <p>This link will expire in 24 hours.</p>
          <p>If you did not create an account, please ignore this email.</p>
        `
      });
    } catch (error) {
      this.logger.error(`Failed to send verification email to ${email}`, error);
    }
  }

  async sendPasswordReset(email: string, rawToken: string): Promise<void> {
    const resetUrl = `${this.clientUrl}/reset-password?token=${rawToken}`;
    const safeUrl = escapeHtml(resetUrl);

    if (this.useConsole) {
      this.logger.log(
        `[PASSWORD RESET] To: ${email}\n  Reset URL: ${resetUrl}`
      );
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: email,
        subject: 'Reset your password',
        html: `
          <h2>Password Reset</h2>
          <p>You requested a password reset. Click the link below to set a new password:</p>
          <p><a href="${safeUrl}">Reset Password</a></p>
          <p>This link will expire in 1 hour.</p>
          <p>If you did not request a password reset, please ignore this email.</p>
        `
      });
    } catch (error) {
      this.logger.error(
        `Failed to send password reset email to ${email}`,
        error
      );
    }
  }

  async sendEmailChangeConfirmation(
    newEmail: string,
    rawToken: string
  ): Promise<void> {
    const confirmUrl = `${this.clientUrl}/confirm-email-change?token=${rawToken}`;
    const safeUrl = escapeHtml(confirmUrl);

    if (this.useConsole) {
      this.logger.log(
        `[EMAIL CHANGE CONFIRMATION] To: ${newEmail}\n  Confirm URL: ${confirmUrl}`
      );
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: newEmail,
        subject: 'Confirm your new email address',
        html: `
          <h2>Confirm Email Change</h2>
          <p>You requested to change the email address on your account to this one.</p>
          <p>Please click the link below to confirm:</p>
          <p><a href="${safeUrl}">Confirm New Email</a></p>
          <p>This link will expire in 1 hour. Your account email will not change until you click it.</p>
          <p>If you did not request this change, please ignore this email.</p>
        `
      });
    } catch (error) {
      this.logger.error(
        `Failed to send email change confirmation to ${newEmail}`,
        error
      );
    }
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
    newEmail: string
  ): Promise<void> {
    const masked = maskEmail(newEmail);
    const safeMasked = escapeHtml(masked);

    if (this.useConsole) {
      this.logger.log(
        `[EMAIL CHANGE NOTIFICATION] To: ${oldEmail}\n  Pending new address (masked): ${masked}`
      );
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: oldEmail,
        subject: 'Email change requested on your account',
        html: `
          <h2>Email Change Requested</h2>
          <p>Someone requested to change your account email to <strong>${safeMasked}</strong>.</p>
          <p>If this was you, no action is needed — open the confirmation link sent to the new address.</p>
          <p>If this was <strong>not</strong> you, change your password immediately and contact support.</p>
          <p>This notification is sent for your security and does not contain any action links.</p>
        `
      });
    } catch (error) {
      this.logger.error(
        `Failed to send email change notification to ${oldEmail}`,
        error
      );
    }
  }

  async sendEmailChangeCompletedNotification(
    oldEmail: string,
    newEmail: string
  ): Promise<void> {
    const safeNew = escapeHtml(newEmail);

    if (this.useConsole) {
      this.logger.log(
        `[EMAIL CHANGE COMPLETE] To: ${oldEmail}\n  New address: ${newEmail}`
      );
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: oldEmail,
        subject: 'Your account email has been changed',
        html: `
          <h2>Email Changed</h2>
          <p>Your account email has been changed to <strong>${safeNew}</strong>.</p>
          <p>If this was not you, contact support immediately.</p>
        `
      });
    } catch (error) {
      this.logger.error(
        `Failed to send email change completed notification to ${oldEmail}`,
        error
      );
    }
  }
}
