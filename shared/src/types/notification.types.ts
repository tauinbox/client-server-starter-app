export type NotificationEvent =
  | { type: 'session_invalidated'; userId: string }
  | { type: 'permissions_updated'; userId: string }
  | {
      type: 'user_crud_events';
      action: 'created' | 'updated' | 'deleted' | 'restored';
      userId: string;
    }
  | { type: 'feature_flags_updated' }
  // Deliberately separate from `permissions_updated`: entitlements are a
  // different access axis, and reusing the permissions event would make every
  // billing change re-fetch CASL rules that did not move.
  | { type: 'entitlements_updated'; userId: string };
