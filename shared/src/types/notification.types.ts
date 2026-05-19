export type NotificationEvent =
  | { type: 'session_invalidated'; userId: string }
  | { type: 'permissions_updated'; userId: string }
  | {
      type: 'user_crud_events';
      action: 'created' | 'updated' | 'deleted' | 'restored';
      userId: string;
    }
  | { type: 'feature_flags_updated' };
