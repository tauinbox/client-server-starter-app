import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { PermissionService } from './permission.service';
import { SecretEncryptionService } from '../../../common/crypto/secret-encryption.service';

/**
 * Decides whether an account must hold a second factor before it reaches a
 * route that `@Authorize` protects.
 *
 * The requirement follows the super flag of the role, which is the same
 * predicate that grants `manage all` in CaslAbilityFactory: an account that
 * reaches everything is the account that has to prove a second factor.
 *
 * Two conditions turn the requirement on, and both are deliberate. The owner
 * opts in with `MFA_REQUIRED_FOR_ADMINS`, because an unattended deploy must
 * not close the administration surface without a decision. `MFA_ENCRYPTION_KEY`
 * must also be present, because every enrolment path answers 503 without it,
 * so a requirement in that state is a lockout with no way out of it.
 */
@Injectable()
export class MfaPolicyService {
  private readonly logger = new Logger(MfaPolicyService.name);
  private readonly optedIn: boolean;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly permissionService: PermissionService,
    private readonly encryption: SecretEncryptionService,
    configService: ConfigService
  ) {
    this.optedIn =
      configService.get<string>('MFA_REQUIRED_FOR_ADMINS') === 'true';

    if (this.optedIn && !this.encryption.isConfigured) {
      this.logger.warn(
        'MFA_REQUIRED_FOR_ADMINS is on while MFA_ENCRYPTION_KEY is empty. ' +
          'Two-factor enrolment answers 503 in this state, so the requirement stays off.'
      );
    }
  }

  /** True when the deployment enforces the requirement at all. */
  get isEnforced(): boolean {
    return this.optedIn && this.encryption.isConfigured;
  }

  /** True when the requirement applies to this account, enrolled or not. */
  async appliesTo(userId: string): Promise<boolean> {
    if (!this.isEnforced) {
      return false;
    }

    const roles = await this.permissionService.getRolesForUser(userId);
    return roles.some((role) => role.isSuper);
  }

  /**
   * True when the account has to enrol before a protected route answers it.
   * An account the lookup cannot find is refused, not admitted.
   */
  async mustEnrol(userId: string): Promise<boolean> {
    if (!(await this.appliesTo(userId))) {
      return false;
    }

    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'totpEnabledAt']
    });

    return user === null || user.totpEnabledAt === null;
  }
}
