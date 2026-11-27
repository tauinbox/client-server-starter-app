import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  ErrorKeys,
  HOME_DATA_REGION,
  isDataRegion,
  type DataRegion
} from '@app/shared/constants';
import type { RegionStatusResponse } from '@app/shared/types';
import { publicRegions } from '@app/shared/utils/public-regions';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { ApiError } from '../../../common/errors/api-error';
import { SETTINGS_DATA_SOURCE } from '../../../data-sources';
import { AuditService, type AuditContext } from '../../audit/audit.service';
import {
  SettingsChangeLogService,
  writeSettings
} from '../settings-change-log/settings-change-log.service';
import { RegionRegistryEntry } from './entities/region-registry-entry.entity';

/** The actor of a status change, as its audit row records it. */
export interface RegionAuditActor {
  actorId: string | null;
  actorEmail: string | null;
  context: AuditContext;
}

/**
 * The public status of each region: whether it takes new accounts. Only the
 * status is a setting; everything else of a region is in the code (MR-D12).
 */
@Injectable()
export class RegionRegistryService {
  constructor(
    @InjectRepository(RegionRegistryEntry, SETTINGS_DATA_SOURCE)
    private readonly entryRepo: Repository<RegionRegistryEntry>,
    private readonly dataSource: DataSource,
    @InjectDataSource(SETTINGS_DATA_SOURCE)
    private readonly settingsDataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly settingsChangeLog: SettingsChangeLogService
  ) {}

  /**
   * The public regions in the order of `DATA_REGIONS`. The home region is
   * always public, so a settings write cannot close every region. A row of a
   * region that the code no longer has is ignored.
   */
  async publicRegions(): Promise<DataRegion[]> {
    const rows = await this.entryRepo.find({ where: { public: true } });
    const open = new Set<string>(rows.map(({ region }) => region));

    return publicRegions((region) => open.has(region));
  }

  /** Opens or closes a region for new accounts. A repeat changes nothing. */
  async setPublic(
    region: string,
    { isPublic, actor }: { isPublic: boolean; actor: RegionAuditActor }
  ): Promise<RegionStatusResponse> {
    if (!isDataRegion(region)) {
      throw new ApiError(ErrorKeys.REGIONS.NOT_FOUND, 'Region not found');
    }

    if (region === HOME_DATA_REGION) {
      throw new ApiError(
        ErrorKeys.REGIONS.CANNOT_CLOSE_HOME,
        'The home region always takes new accounts'
      );
    }

    await writeSettings(
      { regional: this.dataSource, settings: this.settingsDataSource },
      {
        log: this.settingsChangeLog,
        audit: {
          trail: this.auditService,
          draft: {
            action: AuditAction.REGION_STATUS_UPDATE,
            actorId: actor.actorId,
            actorEmail: actor.actorEmail,
            targetId: region,
            targetType: 'Region',
            details: { public: isPublic },
            context: actor.context
          }
        }
      },
      // The log lock of the write orders every settings write, so the read
      // and the write below see no concurrent status change.
      async ({ settings }, recordAudit) => {
        const current = await settings.findOneBy(RegionRegistryEntry, {
          region
        });

        if ((current?.public ?? false) === isPublic) {
          recordAudit(null);

          return;
        }

        await settings.upsert(
          RegionRegistryEntry,
          { region, public: isPublic },
          ['region']
        );
      }
    );

    return { region, public: isPublic };
  }
}
