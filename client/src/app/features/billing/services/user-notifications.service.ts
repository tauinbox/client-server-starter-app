import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Observable } from 'rxjs';
import type {
  CursorPaginatedResponse,
  UserNotificationResponse,
  UserNotificationUnreadCountResponse
} from '@app/shared/types';
import { silentContext } from '@core/context-tokens/error-notifications';
import {
  cursorParams,
  type CursorPageRequest
} from '@shared/utils/pagination.utils';

const NOTIFICATIONS_API_V1 = '/api/v1/notifications';

/** The stored notices of the signed-in user. */
@Injectable({ providedIn: 'root' })
export class UserNotificationsService {
  readonly #http = inject(HttpClient);

  list(
    request: CursorPageRequest = {}
  ): Observable<CursorPaginatedResponse<UserNotificationResponse>> {
    return this.#http.get<CursorPaginatedResponse<UserNotificationResponse>>(
      NOTIFICATIONS_API_V1,
      { params: cursorParams(request), context: silentContext() }
    );
  }

  unreadCount(): Observable<UserNotificationUnreadCountResponse> {
    return this.#http.get<UserNotificationUnreadCountResponse>(
      `${NOTIFICATIONS_API_V1}/unread-count`,
      { context: silentContext() }
    );
  }

  markRead(id: string): Observable<void> {
    return this.#http.post<void>(`${NOTIFICATIONS_API_V1}/${id}/read`, null, {
      context: silentContext()
    });
  }
}
