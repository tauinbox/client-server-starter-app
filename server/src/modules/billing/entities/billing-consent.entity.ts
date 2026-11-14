import {
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  PrimaryGeneratedColumn,
  Unique
} from 'typeorm';
import type { LegalJurisdiction } from '@app/shared/constants';
import { User } from '../../users/entities/user.entity';

/** The documents that a buyer accepts before a payment. */
export type BillingConsentKind = 'terms';

/**
 * Append-only journal of the documents that a user accepted before a
 * checkout or a purchase. One row for each version: a second acceptance of
 * the same version adds no row.
 */
@Entity('billing_consents')
@Unique('UQ_billing_consents_acceptance', [
  'userId',
  'kind',
  'jurisdiction',
  'documentVersion'
])
export class BillingConsent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  // RESTRICT: the row is the proof of the consent and must survive any future
  // hard-delete of a user; erasure requires an explicit archival step
  @ForeignKey<User>(() => User, {
    onDelete: 'RESTRICT',
    name: 'FK_billing_consents_user_id'
  })
  userId: string;

  @Column({ type: 'varchar', length: 16 })
  kind: BillingConsentKind;

  @Column({ type: 'varchar', length: 8 })
  jurisdiction: LegalJurisdiction;

  @Column({ name: 'document_version', type: 'varchar', length: 32 })
  documentVersion: string;

  @CreateDateColumn({ name: 'accepted_at', type: 'timestamptz' })
  acceptedAt: Date;
}
