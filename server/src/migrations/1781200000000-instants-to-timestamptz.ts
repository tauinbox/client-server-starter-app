import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Converts every naive `timestamp without time zone` instant column to
 * `timestamptz`. Existing rows were written by a process running in UTC (the
 * base image default), so reinterpreting their stored wall-clock as UTC via
 * `AT TIME ZONE 'UTC'` preserves the exact instant. `users.deleted_at` is
 * already `timestamptz` and is intentionally omitted.
 */
export class InstantsToTimestamptz1781200000000 implements MigrationInterface {
  private readonly columns: ReadonlyArray<readonly [string, string]> = [
    ['users', 'locked_until'],
    ['users', 'email_verification_expires_at'],
    ['users', 'password_reset_expires_at'],
    ['users', 'pending_email_expires_at'],
    ['users', 'token_revoked_at'],
    ['users', 'created_at'],
    ['users', 'updated_at'],
    ['refresh_tokens', 'expires_at'],
    ['refresh_tokens', 'created_at'],
    ['audit_logs', 'created_at'],
    ['actions', 'created_at'],
    ['oauth_accounts', 'created_at'],
    ['permissions', 'created_at'],
    ['resources', 'last_synced_at'],
    ['resources', 'created_at'],
    ['roles', 'created_at'],
    ['roles', 'updated_at'],
    ['feature_flags', 'created_at'],
    ['feature_flags', 'updated_at'],
    ['feature_flag_rules', 'created_at'],
    ['feature_flag_rules', 'updated_at'],
    ['plans', 'created_at'],
    ['plans', 'updated_at'],
    ['billing_products', 'created_at'],
    ['billing_products', 'updated_at'],
    ['billing_customers', 'created_at'],
    ['billing_customers', 'updated_at'],
    ['billing_payment_methods', 'created_at'],
    ['billing_payment_methods', 'updated_at'],
    ['billing_customer_grants', 'expires_at'],
    ['billing_customer_grants', 'revoked_at'],
    ['billing_customer_grants', 'created_at'],
    ['billing_invoices', 'period_start'],
    ['billing_invoices', 'period_end'],
    ['billing_invoices', 'paid_at'],
    ['billing_invoices', 'created_at'],
    ['billing_invoices', 'updated_at'],
    ['subscriptions', 'current_period_start'],
    ['subscriptions', 'current_period_end'],
    ['subscriptions', 'trial_end'],
    ['subscriptions', 'next_renewal_attempt_at'],
    ['subscriptions', 'created_at'],
    ['subscriptions', 'updated_at'],
    ['billing_usage_records', 'occurred_at'],
    ['billing_usage_records', 'recorded_at'],
    ['billing_webhook_events', 'received_at'],
    ['billing_webhook_events', 'processed_at'],
    ['billing_credit_ledger', 'created_at'],
    ['billing_credit_balances', 'updated_at']
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column] of this.columns) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE timestamptz USING "${column}" AT TIME ZONE 'UTC'`
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column] of this.columns) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE timestamp USING "${column}" AT TIME ZONE 'UTC'`
      );
    }
  }
}
