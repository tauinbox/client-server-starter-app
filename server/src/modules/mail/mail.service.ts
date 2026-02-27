import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

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
          <p><a href="${verifyUrl}">Verify Email</a></p>
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
          <p><a href="${resetUrl}">Reset Password</a></p>
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
}
