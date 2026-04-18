import type { Provider } from '@nestjs/common';
import { OwnershipResolver } from './ownership.resolver';
import { FieldMatchResolver } from './field-match.resolver';
import { UserAttrResolver } from './user-attr.resolver';
import { CustomResolver } from './custom.resolver';
import { CONDITION_RESOLVERS } from './condition-resolvers.token';
import type { ConditionResolver } from './condition-resolver.interface';

export { CONDITION_RESOLVERS } from './condition-resolvers.token';
export type {
  ConditionResolver,
  ResolverContext,
  ResolverOutcome,
  PermissionConditionKey
} from './condition-resolver.interface';
export { OwnershipResolver } from './ownership.resolver';
export { FieldMatchResolver } from './field-match.resolver';
export { UserAttrResolver } from './user-attr.resolver';
export { CustomResolver } from './custom.resolver';

/**
 * Built-in resolver classes. Order matters: it determines the order in which
 * fragments are merged into the rule's MongoQuery, so when two resolvers write
 * the same field key the later one wins (matches pre-refactor source order).
 */
export const BUILT_IN_CONDITION_RESOLVERS = [
  OwnershipResolver,
  FieldMatchResolver,
  UserAttrResolver,
  CustomResolver
] as const;

/**
 * Providers to register in `CaslModule`. Each resolver class is provided as a
 * regular Nest provider (so it can use DI itself), then aggregated into a
 * `ConditionResolver[]` under the `CONDITION_RESOLVERS` token.
 */
export const CONDITION_RESOLVER_PROVIDERS: Provider[] = [
  ...BUILT_IN_CONDITION_RESOLVERS,
  {
    provide: CONDITION_RESOLVERS,
    useFactory: (...resolvers: ConditionResolver[]): ConditionResolver[] =>
      resolvers,
    inject: [...BUILT_IN_CONDITION_RESOLVERS]
  }
];
