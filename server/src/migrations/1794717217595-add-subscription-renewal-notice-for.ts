import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionRenewalNoticeFor1794717217595 implements MigrationInterface {
  name = 'AddSubscriptionRenewalNoticeFor1794717217595';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD "renewal_notice_for" TIMESTAMP WITH TIME ZONE`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "subscriptions" DROP COLUMN "renewal_notice_for"`
    );
  }
}
