export type FeatureFlagChangeType =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'toggled'
  | 'rules-replaced';

export class FeatureFlagChangedEvent {
  constructor(
    public readonly flagKey: string,
    public readonly changeType: FeatureFlagChangeType
  ) {}
}
