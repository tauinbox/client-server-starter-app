import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import type { Observable } from 'rxjs';
import type {
  FeatureFlagRuleEffect,
  FeatureFlagRuleType
} from '@app/shared/constants';
import type {
  FeatureFlagAttributeKeysResponse,
  FeatureFlagPreviewResult,
  FeatureFlagResponse,
  FeatureFlagRulePayload
} from '@app/shared/types';

import type { CursorPaginatedResponse } from '@app/shared/types';
import {
  cursorParams,
  type CursorPageRequest
} from '@shared/utils/pagination.utils';

const ADMIN_API_V1 = '/api/v1/admin/feature-flags';

export type CreateFeatureFlag = {
  key: string;
  description?: string | null;
  enabled?: boolean;
  environments?: string[];
  public?: boolean;
};

export type UpdateFeatureFlag = Partial<CreateFeatureFlag>;

export type FeatureFlagRuleInput = {
  type: FeatureFlagRuleType;
  effect: FeatureFlagRuleEffect;
  payload: FeatureFlagRulePayload;
};

export type PreviewFlagContext = {
  userId?: string;
  roles?: string[];
  attributes?: Record<string, unknown>;
  env?: string;
  anonId?: string;
};

/**
 * Unsaved flag state the preview evaluates instead of the stored one. Omitted
 * fields fall back to what the server has persisted.
 */
export type PreviewFlagDraft = {
  rules?: FeatureFlagRuleInput[];
  enabled?: boolean;
  environments?: string[];
};

export type PreviewFlagRequest = PreviewFlagContext & PreviewFlagDraft;

@Injectable({ providedIn: 'root' })
export class FeatureFlagsAdminService {
  readonly #http = inject(HttpClient);

  /** One page of flags for the admin list page. */
  getAllCursor(
    request: CursorPageRequest
  ): Observable<CursorPaginatedResponse<FeatureFlagResponse>> {
    return this.#http.get<CursorPaginatedResponse<FeatureFlagResponse>>(
      `${ADMIN_API_V1}/cursor`,
      { params: cursorParams(request) }
    );
  }

  /**
   * The custom attribute keys a rule payload may reference. A reference load,
   * like the role catalog: the picker needs the whole set in one response, and
   * the set is a server-runtime fact, so no client constant can replace it.
   */
  getAttributeKeys(): Observable<FeatureFlagAttributeKeysResponse> {
    return this.#http.get<FeatureFlagAttributeKeysResponse>(
      `${ADMIN_API_V1}/attribute-keys`
    );
  }

  getAll(): Observable<FeatureFlagResponse[]> {
    return this.#http.get<FeatureFlagResponse[]>(ADMIN_API_V1);
  }

  getOne(id: string): Observable<FeatureFlagResponse> {
    return this.#http.get<FeatureFlagResponse>(`${ADMIN_API_V1}/${id}`);
  }

  create(data: CreateFeatureFlag): Observable<FeatureFlagResponse> {
    return this.#http.post<FeatureFlagResponse>(ADMIN_API_V1, data);
  }

  update(
    id: string,
    data: UpdateFeatureFlag,
    expectedVersion: number
  ): Observable<FeatureFlagResponse> {
    return this.#http.patch<FeatureFlagResponse>(
      `${ADMIN_API_V1}/${id}`,
      data,
      {
        headers: new HttpHeaders({ 'If-Match': String(expectedVersion) })
      }
    );
  }

  delete(id: string): Observable<void> {
    return this.#http.delete<void>(`${ADMIN_API_V1}/${id}`);
  }

  replaceRules(
    id: string,
    rules: FeatureFlagRuleInput[]
  ): Observable<FeatureFlagResponse> {
    return this.#http.put<FeatureFlagResponse>(`${ADMIN_API_V1}/${id}/rules`, {
      rules
    });
  }

  toggle(id: string): Observable<FeatureFlagResponse> {
    return this.#http.post<FeatureFlagResponse>(
      `${ADMIN_API_V1}/${id}/toggle`,
      {}
    );
  }

  preview(
    id: string,
    request: PreviewFlagRequest
  ): Observable<FeatureFlagPreviewResult> {
    return this.#http.post<FeatureFlagPreviewResult>(
      `${ADMIN_API_V1}/${id}/preview`,
      request
    );
  }
}
