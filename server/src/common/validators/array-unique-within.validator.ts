import { buildMessage, ValidateBy, ValidationOptions } from 'class-validator';

/**
 * `@ArrayUnique` in linear time. class-validator compares with `indexOf`
 * inside `filter`, which is quadratic, and runs it even when `ArrayMaxSize`
 * fails. Thus a body of many short items costs CPU that the size cap does not
 * limit. This check skips a value that is not an array or that is longer than
 * `maxSize`: `IsArray` and `ArrayMaxSize` report those. A null or undefined
 * item is its own key, as in `@ArrayUnique`.
 */
export function ArrayUniqueWithin(
  maxSize: number,
  identifier: (item: unknown) => unknown = (item) => item,
  validationOptions?: ValidationOptions
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'arrayUniqueWithin',
      validator: {
        validate: (value: unknown): boolean => {
          if (!Array.isArray(value) || value.length > maxSize) return true;
          const keys = value.map((item: unknown) =>
            item != null ? identifier(item) : item
          );
          return new Set(keys).size === keys.length;
        },
        defaultMessage: buildMessage(
          (eachPrefix) =>
            `${eachPrefix}All $property's elements must be unique`,
          validationOptions
        )
      }
    },
    validationOptions
  );
}
