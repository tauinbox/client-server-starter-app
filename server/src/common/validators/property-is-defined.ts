/**
 * Condition for `@ValidateIf`, replacing `@IsOptional()` on an optional field
 * whose column is NOT NULL. `@IsOptional()` skips the remaining validators for
 * `undefined` *and* `null`, so an explicit `null` is accepted and assigned to
 * the entity; this condition only skips an omitted property.
 *
 * A class built with `PartialType` cannot use this - the `@IsOptional()` that
 * `PartialType` injects short-circuits any extra condition. Pass the built-in
 * `{ skipNullProperties: false }` option there instead. Note that the option
 * has no effect on a property the parent class already marks `@IsOptional()`,
 * which then has to be converted here in the parent.
 */
export const propertyIsDefined = (_: unknown, value: unknown): boolean =>
  value !== undefined;
