import { ApiProperty } from '@nestjs/swagger';
import type {
  UserNotificationKind,
  UserNotificationResponse,
  UserNotificationUnreadCountResponse,
  _AssertNever
} from '@app/shared/types';

// A record, so that a new kind does not compile until it is listed here.
const KIND_SET: Record<UserNotificationKind, true> = {
  invoice_paid: true,
  payment_failed: true,
  subscription_cancel_scheduled: true,
  subscription_canceled: true,
  refund_issued: true,
  credit_balance_depleted: true
};
const KINDS = Object.keys(KIND_SET);

/**
 * The Swagger shape of a notice. `kind` selects the shape of `payload`
 * (`UserNotificationPayloads`), which a class cannot express, so the checks
 * below compare the field names only.
 */
export class UserNotificationResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ enum: KINDS, example: 'invoice_paid' })
  kind: UserNotificationKind;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { invoiceId: '123e4567-e89b-12d3-a456-426614174000' }
  })
  payload: UserNotificationResponse['payload'];

  @ApiProperty({ example: '2026-11-14T10:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ nullable: true, example: null })
  readAt: Date | null;
}

type _DtoKeysInShared = _AssertNever<
  Exclude<keyof UserNotificationResponseDto, keyof UserNotificationResponse>
>;
type _SharedKeysInDto = _AssertNever<
  Exclude<keyof UserNotificationResponse, keyof UserNotificationResponseDto>
>;

export class UserNotificationUnreadCountResponseDto implements UserNotificationUnreadCountResponse {
  @ApiProperty({ example: 2 })
  unread: number;
}
