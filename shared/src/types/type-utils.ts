// Side-effect import pulls type-only test assertions into compilation so
// any consumer of @app/shared/types (server build, client build, mock-server
// tsc) surfaces broken structural-diff invariants as compile errors. The
// imported module has no runtime exports; type-only consumers erase it.
import './__tests__/structural-diff.test-d';

/**
 * Recursively converts Date fields to string to match the JSON wire format.
 *
 * Use this when comparing a server DTO (Date objects) against a shared
 * response type (string, reflecting JSON serialization). Recurses into
 * arrays and nested objects so that nested DTOs compare structurally
 * against their shared equivalents — e.g. `roles: RoleResponseDto[]` on
 * a DTO normalises to `roles: { ...; createdAt: string }[]` matching the
 * shape of `RoleResponse[]` on the shared side.
 *
 * @example
 *   type _Check = WireType<UserResponseDto> extends UserResponse ? ... : ...
 */
export type WireType<T> = T extends Date
  ? string
  : T extends ReadonlyArray<infer U>
    ? Array<WireType<U>>
    : // eslint-disable-next-line @typescript-eslint/no-explicit-any
      T extends (...args: any[]) => any
      ? T
      : T extends object
        ? { [K in keyof T]: WireType<T[K]> }
        : T;

/**
 * Compile-time assertion that T is `never`.
 *
 * Instantiating this with a non-`never` argument causes a TypeScript error,
 * which is exactly the behaviour we want in entity / DTO contract files.
 *
 * @example
 *   type _Check = _AssertNever<Exclude<keyof Entity, keyof ResponseType>>;
 *   // → compile error if Entity has fields not present in ResponseType
 */
export type _AssertNever<T extends never> = T;

/**
 * Reports the keys of A whose value type is not structurally compatible with B.
 *
 * For each key K of A:
 *   - If K is missing in B → K is reported.
 *   - If A[K] is not assignable to B[K] (after stripping `undefined` from
 *     either side to normalise optional vs required asymmetry) → K is reported.
 *   - Otherwise → K contributes `never`.
 *
 * The result is the union of reported keys, or `never` when A and B match
 * structurally. Combined with `_AssertNever` and applied bidirectionally,
 * this catches both missing-key drift and value-type drift between a DTO
 * and its shared response type — strictly more powerful than the previous
 * keys-only `Exclude<keyof A, keyof B>` check, which would miss cases such
 * as `roles: RoleResponse[]` being silently retyped to `roles: string[]`.
 *
 * Tuple-wrapping (`[X] extends [Y]`) prevents distribution over union types,
 * so the full union must be assignable, not just one branch.
 */
export type StructuralDiff<A, B> = {
  [K in keyof A]-?: K extends keyof B
    ? [Exclude<A[K], undefined>] extends [Exclude<B[K], undefined>]
      ? never
      : K
    : K;
}[keyof A];
