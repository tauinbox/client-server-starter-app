export type NotificationEvent =
  | { type: 'session_invalidated' }
  | { type: 'permissions_updated' }
  | {
      type: 'user_crud_events';
      action: 'created' | 'updated' | 'deleted' | 'restored';
      userId: string;
    }
  // A change that touches the rows of many users at once (a role rename or
  // delete changes the role chip of every holder). It names no user.
  | { type: 'user_list_stale' }
  | { type: 'feature_flags_updated' }
  // Deliberately separate from `permissions_updated`: entitlements are a
  // different access axis, and reusing the permissions event would make every
  // billing change re-fetch CASL rules that did not move.
  | { type: 'entitlements_updated' };
