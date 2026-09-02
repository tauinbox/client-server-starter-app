import { MfaPolicyService } from './mfa-policy.service';
import { SecretEncryptionService } from '../../../common/crypto/secret-encryption.service';
import { createMockConfigService } from '../../../common/testing/config-service.mock';

const KEY = Buffer.alloc(32, 7).toString('base64');

describe('MfaPolicyService', () => {
  let repository: { findOne: jest.Mock };
  let permissionService: { getRolesForUser: jest.Mock };

  function build(env: Record<string, string>): MfaPolicyService {
    const config = createMockConfigService(env);

    return new MfaPolicyService(
      // @ts-expect-error testing mock
      repository,
      permissionService,
      new SecretEncryptionService(config),
      config
    );
  }

  beforeEach(() => {
    repository = { findOne: jest.fn() };
    permissionService = { getRolesForUser: jest.fn() };
  });

  describe('isEnforced', () => {
    it('is off while nobody opted in', () => {
      expect(build({ MFA_ENCRYPTION_KEY: KEY }).isEnforced).toBe(false);
    });

    it('is off while the encryption key is empty, because enrolment answers 503', () => {
      const service = build({
        MFA_ENCRYPTION_KEY: '',
        MFA_REQUIRED_FOR_ADMINS: 'true'
      });

      expect(service.isEnforced).toBe(false);
    });

    it('is on when the flag and the key are both set', () => {
      const service = build({
        MFA_ENCRYPTION_KEY: KEY,
        MFA_REQUIRED_FOR_ADMINS: 'true'
      });

      expect(service.isEnforced).toBe(true);
    });
  });

  describe('mustEnrol', () => {
    const enforcedEnv = {
      MFA_ENCRYPTION_KEY: KEY,
      MFA_REQUIRED_FOR_ADMINS: 'true'
    };

    it('demands an enrolment from a super role that has none', async () => {
      permissionService.getRolesForUser.mockResolvedValue([
        { name: 'admin', isSuper: true }
      ]);
      repository.findOne.mockResolvedValue({
        id: 'user-1',
        totpEnabledAt: null
      });

      await expect(build(enforcedEnv).mustEnrol('user-1')).resolves.toBe(true);
    });

    it('admits a super role that completed the enrolment', async () => {
      permissionService.getRolesForUser.mockResolvedValue([
        { name: 'admin', isSuper: true }
      ]);
      repository.findOne.mockResolvedValue({
        id: 'user-1',
        totpEnabledAt: new Date()
      });

      await expect(build(enforcedEnv).mustEnrol('user-1')).resolves.toBe(false);
    });

    it('leaves an account without a super role alone', async () => {
      permissionService.getRolesForUser.mockResolvedValue([
        { name: 'editor', isSuper: false }
      ]);

      await expect(build(enforcedEnv).mustEnrol('user-1')).resolves.toBe(false);
      expect(repository.findOne).not.toHaveBeenCalled();
    });

    it('refuses an account the lookup cannot find', async () => {
      permissionService.getRolesForUser.mockResolvedValue([
        { name: 'admin', isSuper: true }
      ]);
      repository.findOne.mockResolvedValue(null);

      await expect(build(enforcedEnv).mustEnrol('user-1')).resolves.toBe(true);
    });

    it('reads no role while the requirement is off', async () => {
      const service = build({ MFA_ENCRYPTION_KEY: KEY });

      await expect(service.mustEnrol('user-1')).resolves.toBe(false);
      expect(permissionService.getRolesForUser).not.toHaveBeenCalled();
    });
  });

  describe('appliesTo', () => {
    it('is true for a super role even after it enrolled', async () => {
      permissionService.getRolesForUser.mockResolvedValue([
        { name: 'admin', isSuper: true }
      ]);
      const service = build({
        MFA_ENCRYPTION_KEY: KEY,
        MFA_REQUIRED_FOR_ADMINS: 'true'
      });

      await expect(service.appliesTo('user-1')).resolves.toBe(true);
      expect(repository.findOne).not.toHaveBeenCalled();
    });
  });
});
