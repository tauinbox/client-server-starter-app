import type { OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  MatCard,
  MatCardContent,
  MatCardHeader,
  MatCardTitle,
  MatCardSubtitle
} from '@angular/material/card';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatChip, MatChipSet } from '@angular/material/chips';
import { MatDivider } from '@angular/material/divider';
import {
  MatAccordion,
  MatExpansionPanel,
  MatExpansionPanelHeader,
  MatExpansionPanelTitle,
  MatExpansionPanelDescription
} from '@angular/material/expansion';
import { TranslocoDirective } from '@jsverse/transloco';
import type {
  PermissionCondition,
  ResolvedPermission,
  RoleResponse,
  UserEffectivePermissionsResponse
} from '@app/shared/types';
import { UserService } from '../../services/user.service';
import { RbacMetadataStore } from '@features/auth/store/rbac-metadata.store';

type ResourceGroup = {
  name: string;
  displayName: string;
  allowCount: number;
  denyCount: number;
  hasDeny: boolean;
  permissions: ResolvedPermission[];
};

@Component({
  selector: 'app-user-permissions',
  imports: [
    RouterLink,
    MatCard,
    MatCardHeader,
    MatCardTitle,
    MatCardSubtitle,
    MatCardContent,
    MatButton,
    MatIconButton,
    MatIcon,
    MatProgressSpinner,
    MatChip,
    MatChipSet,
    MatDivider,
    MatAccordion,
    MatExpansionPanel,
    MatExpansionPanelHeader,
    MatExpansionPanelTitle,
    MatExpansionPanelDescription,
    TranslocoDirective
  ],
  templateUrl: './user-permissions.component.html',
  styleUrl: './user-permissions.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserPermissionsComponent implements OnInit {
  readonly #userService = inject(UserService);
  readonly #destroyRef = inject(DestroyRef);
  readonly #rbacMetadataStore = inject(RbacMetadataStore);

  readonly id = input.required<string>();

  readonly #data = signal<UserEffectivePermissionsResponse | null>(null);
  readonly #loading = signal(true);
  readonly #error = signal(false);
  readonly #expanded = signal(false);

  readonly loading = this.#loading.asReadonly();
  readonly error = this.#error.asReadonly();
  readonly expanded = this.#expanded.asReadonly();
  readonly roles = computed<RoleResponse[]>(() => this.#data()?.roles ?? []);

  readonly isSuper = computed(() => this.roles().some((r) => r.isSuper));

  readonly groups = computed<ResourceGroup[]>(() => {
    const data = this.#data();
    if (!data) return [];
    const resources = this.#rbacMetadataStore.resources();
    const displayNameByName = new Map(
      resources.map((r) => [r.name, r.displayName])
    );

    const byResource = new Map<string, ResolvedPermission[]>();
    for (const p of data.permissions) {
      const list = byResource.get(p.resource) ?? [];
      list.push(p);
      byResource.set(p.resource, list);
    }

    const groups: ResourceGroup[] = [];
    for (const [name, perms] of byResource) {
      const allowCount = perms.filter(
        (p) => p.conditions?.effect !== 'deny'
      ).length;
      const denyCount = perms.length - allowCount;
      groups.push({
        name,
        displayName: displayNameByName.get(name) ?? name,
        allowCount,
        denyCount,
        hasDeny: denyCount > 0,
        permissions: [...perms].sort((a, b) => a.action.localeCompare(b.action))
      });
    }
    return groups.sort((a, b) => a.displayName.localeCompare(b.displayName));
  });

  readonly summary = computed(() => {
    const perms = this.#data()?.permissions ?? [];
    let allow = 0;
    let deny = 0;
    let conditional = 0;
    for (const p of perms) {
      const isDeny = p.conditions?.effect === 'deny';
      if (isDeny) deny++;
      else allow++;
      if (p.conditions) {
        const { effect: _e, ...rest } = p.conditions;
        if (Object.keys(rest).length > 0) conditional++;
      }
    }
    return { allow, deny, conditional };
  });

  ngOnInit(): void {
    this.fetch();
  }

  toggleAll(): void {
    this.#expanded.update((v) => !v);
  }

  formatConditions(conditions: PermissionCondition): string {
    const { effect: _e, ...rest } = conditions;
    return JSON.stringify(rest, null, 2);
  }

  hasRenderableConditions(conditions: PermissionCondition | null): boolean {
    if (!conditions) return false;
    const { effect: _e, ...rest } = conditions;
    return Object.keys(rest).length > 0;
  }

  private fetch(): void {
    this.#loading.set(true);
    this.#error.set(false);
    this.#userService
      .getPermissions(this.id())
      .pipe(takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: (data) => {
          this.#data.set(data);
          this.#loading.set(false);
        },
        error: () => {
          this.#error.set(true);
          this.#loading.set(false);
        }
      });
  }
}
