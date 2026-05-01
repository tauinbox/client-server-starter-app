/**
 * Type-only tests for StructuralDiff and WireType.
 *
 * Every assertion in this file is evaluated at compile time. A broken
 * invariant fails `tsc` (and therefore `nest build` / `ng build` / Jest
 * with ts-jest), which is the same gate the DTO contract files rely on.
 */

import type { StructuralDiff, WireType, _AssertNever } from '../type-utils';

// ── Equality helper (Matt-Pocock-style identity check) ──────────────────────
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

type Expect<T extends true> = T;

// ── 1. Matching types → never ───────────────────────────────────────────────
type _Match_Empty = Expect<Equal<StructuralDiff<{}, {}>, never>>;
type _Match_OneKey = Expect<
  Equal<StructuralDiff<{ a: string }, { a: string }>, never>
>;
type _Match_ManyKeys = Expect<
  Equal<
    StructuralDiff<{ a: string; b: number }, { a: string; b: number }>,
    never
  >
>;
type _Match_Nested = Expect<
  Equal<
    StructuralDiff<{ a: { b: number } }, { a: { b: number } }>,
    never
  >
>;

// ── 2. Extra key in A → that key reported ───────────────────────────────────
type _Extra_OneMissingInB = Expect<
  Equal<StructuralDiff<{ a: string; b: number }, { a: string }>, 'b'>
>;
type _Extra_TwoMissingInB = Expect<
  Equal<StructuralDiff<{ x: 1; y: 2; z: 3 }, { x: 1 }>, 'y' | 'z'>
>;

// ── 3. Different value type → key reported ──────────────────────────────────
type _Type_Primitive = Expect<
  Equal<StructuralDiff<{ a: number }, { a: string }>, 'a'>
>;
type _Type_ArrayElement = Expect<
  Equal<StructuralDiff<{ a: string[] }, { a: number[] }>, 'a'>
>;
type _Type_ObjectShape = Expect<
  Equal<
    StructuralDiff<{ a: { b: number } }, { a: { b: string } }>,
    'a'
  >
>;

// ── 4. Optional vs required asymmetry is normalised ─────────────────────────
//     A DTO class declares fields as required; the shared type may declare
//     the same field optional. StructuralDiff strips `undefined` so this
//     does not register as drift.
type _Optional_NotReportedWhenValueMatches = Expect<
  Equal<
    StructuralDiff<{ a: string | null }, { a?: string | null }>,
    never
  >
>;
type _Optional_NotReportedReverse = Expect<
  Equal<
    StructuralDiff<{ a?: string | null }, { a: string | null }>,
    never
  >
>;

// ── 5. WireType normalises Date → string recursively ────────────────────────
type _Wire_TopLevelDate = Expect<
  Equal<WireType<{ createdAt: Date }>, { createdAt: string }>
>;
type _Wire_NullableDate = Expect<
  Equal<WireType<{ deletedAt: Date | null }>, { deletedAt: string | null }>
>;
type _Wire_NestedArrayOfObjects = Expect<
  Equal<
    WireType<{ items: { createdAt: Date }[] }>,
    { items: { createdAt: string }[] }
  >
>;
type _Wire_LeavesPrimitivesAlone = Expect<
  Equal<
    WireType<{ id: string; isActive: boolean; count: number }>,
    { id: string; isActive: boolean; count: number }
  >
>;

// ── 6. Nested-array element retyped to a primitive ──────────────────────────
//     The most subtle drift the helper protects against: a DTO claims
//     `items: string[]` but the shared type uses `items: { id; name; ... }[]`.
//     A keys-only check would pass — both sides have key `items`. The
//     structural check correctly reports `items`.
type _NestedShape = { id: string; name: string };
type _ParentWithObjects = { id: string; items: _NestedShape[] };
type _ParentWithMatchingObjects = {
  id: string;
  items: { id: string; name: string }[];
};
type _ParentWithStrings = { id: string; items: string[] };

type _NestedShape_StructurallyEqual = Expect<
  Equal<StructuralDiff<_ParentWithObjects, _ParentWithMatchingObjects>, never>
>;
type _NestedShape_StructurallyEqualReverse = Expect<
  Equal<StructuralDiff<_ParentWithMatchingObjects, _ParentWithObjects>, never>
>;
type _NestedShape_PrimitiveDriftCaught = Expect<
  Equal<StructuralDiff<_ParentWithObjects, _ParentWithStrings>, 'items'>
>;
type _NestedShape_PrimitiveDriftCaughtReverse = Expect<
  Equal<StructuralDiff<_ParentWithStrings, _ParentWithObjects>, 'items'>
>;

// ── 7. _AssertNever rejects a non-`never` diff ──────────────────────────────
//     Proves the whole pattern end-to-end: when StructuralDiff yields a
//     non-never union, _AssertNever fails to compile. The `@ts-expect-error`
//     directive keeps this file itself green while still asserting that the
//     rejection happens — exactly the failure a broken DTO contract would
//     produce in CI.

type _Drift = StructuralDiff<_ParentWithObjects, _ParentWithStrings>;
// @ts-expect-error - _Drift is 'items' (not never); _AssertNever rejects.
type _AssertNever_RejectsNonNever = _AssertNever<_Drift>;

// Sanity: a matching pair satisfies _AssertNever cleanly (no error).
type _Match = StructuralDiff<_ParentWithObjects, _ParentWithMatchingObjects>;
type _AssertNever_AcceptsMatch = _AssertNever<_Match>;

// Module marker — keeps this file in module mode so the side-effect import
// from type-utils.ts resolves predictably.
export {};
