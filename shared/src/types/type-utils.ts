/**
 * Converts Date fields to string to match the JSON wire format.
 *
 * Use this when comparing a server DTO (which uses Date objects) against a
 * shared response type (which uses string, reflecting JSON serialization).
 *
 * @example
 *   type _Check = WireType<UserResponseDto> extends UserResponse ? ... : ...
 */
export type WireType<T> = {
  [K in keyof T]: T[K] extends Date | null
    ? string | null
    : T[K] extends Date
      ? string
      : T[K];
};

/**
 * Compile-time assertion that T is `never`.
 *
 * Instantiating this type with a non-`never` argument causes a TypeScript
 * error, which is exactly the behaviour we want in entity/DTO contract files.
 *
 * @example
 *   type _Check = _AssertNever<Exclude<keyof Entity, keyof ResponseType>>;
 *   // → compile error if Entity has fields not present in ResponseType
 */
export type _AssertNever<T extends never> = T;
