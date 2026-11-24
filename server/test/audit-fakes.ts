/** The id that `fakeSettingsAuditTrail` gives the audit row of each write. */
export const FAKE_SETTINGS_AUDIT_ID = '00000000-0000-4000-8000-000000000001';

/**
 * The settings write methods of a fake `AuditService`, for a suite that
 * replaces the service: `writeSettings` commits the audit row before the
 * write and closes it after.
 */
export function fakeSettingsAuditTrail() {
  return {
    openSettingsWrite: jest
      .fn<Promise<string>, [unknown]>()
      .mockResolvedValue(FAKE_SETTINGS_AUDIT_ID),
    closeSettingsWrite: jest
      .fn<Promise<void>, [string, unknown]>()
      .mockResolvedValue(undefined),
    discardSettingsWrite: jest
      .fn<Promise<void>, [string]>()
      .mockResolvedValue(undefined)
  };
}
