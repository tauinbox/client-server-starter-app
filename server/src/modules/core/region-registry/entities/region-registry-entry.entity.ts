import { Exclude } from 'class-transformer';
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { DataRegion } from '@app/shared/constants';
import { SETTINGS_SCHEMA } from '../../../../database-roles';

/**
 * The public status of one region. The countries, the integrations and the
 * API host of a region are in the region constants of the code, so a settings
 * write cannot move the traffic of a region. A region with no row is not
 * public; the home region is public in the code, with or without a row.
 */
@Entity({ name: 'region_registry', schema: SETTINGS_SCHEMA })
export class RegionRegistryEntry {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  region: DataRegion;

  @Column({ type: 'boolean' })
  public: boolean;

  @Exclude()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz', precision: 3 })
  updatedAt: Date;
}
