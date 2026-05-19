import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';

export interface AttributeResolverUser {
  userId: string;
  email?: string | null;
  createdAt?: Date | string | null;
}

/**
 * Resolves a value for a single attribute key given the current user and request.
 * Returning `undefined` means "no value to contribute".
 */
export type AttributeResolver = (
  user: AttributeResolverUser | null,
  req: Request
) => unknown;

const BUILT_IN_RESOLVERS: Record<string, AttributeResolver> = {
  email: (user) => user?.email ?? undefined,
  emailDomain: (user) => {
    const email = user?.email;
    if (typeof email !== 'string') return undefined;
    const at = email.lastIndexOf('@');
    return at >= 0 ? email.slice(at + 1) : undefined;
  },
  createdAt: (user) => user?.createdAt ?? undefined
};

@Injectable()
export class AttributeRegistryService {
  private readonly logger = new Logger(AttributeRegistryService.name);
  private readonly resolvers = new Map<string, AttributeResolver>();

  constructor() {
    for (const [key, resolver] of Object.entries(BUILT_IN_RESOLVERS)) {
      this.resolvers.set(key, resolver);
    }
  }

  /**
   * Registers a resolver for a `custom` attribute key. Modules call this from
   * `onModuleInit` to expose tenant/org/region/etc. attributes to the feature
   * flag evaluator without modifying the evaluator itself.
   */
  registerAttribute(key: string, resolver: AttributeResolver): void {
    if (this.resolvers.has(key)) {
      this.logger.warn(
        `Attribute resolver "${key}" already registered — overriding`
      );
    }
    this.resolvers.set(key, resolver);
  }

  /** Returns the set of attribute keys safe to reference from rule payloads. */
  getKnownKeys(): ReadonlySet<string> {
    return new Set(this.resolvers.keys());
  }

  /** Returns the set of `custom` keys (excluding the built-in non-custom fields). */
  getKnownCustomKeys(): ReadonlySet<string> {
    const all = new Set(this.resolvers.keys());
    for (const built of Object.keys(BUILT_IN_RESOLVERS)) {
      all.delete(built);
    }
    return all;
  }

  resolveAll(
    user: AttributeResolverUser | null,
    req: Request
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, resolver] of this.resolvers.entries()) {
      try {
        const value = resolver(user, req);
        if (value !== undefined) {
          out[key] = value;
        }
      } catch (err) {
        this.logger.warn(
          `Attribute resolver "${key}" threw — skipping. ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
    return out;
  }
}
