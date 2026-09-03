import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface
} from 'class-validator';
import {
  exceedsPasswordByteLimit,
  passwordByteLimitMessage
} from '@app/shared/utils/password-bytes';

/**
 * `@MaxLength` counts UTF-16 code units, so it cannot express bcrypt's limit,
 * which is a byte count. This rule belongs only on a field whose value is
 * hashed for storage - see MAX_NEW_PASSWORD_BYTES for why a field that is
 * only verified must keep the higher cap.
 */
@ValidatorConstraint({ name: 'isWithinPasswordByteLimit', async: false })
export class IsWithinPasswordByteLimitConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return !exceedsPasswordByteLimit(value);
  }

  defaultMessage(args: ValidationArguments): string {
    return passwordByteLimitMessage(args.property);
  }
}

export function IsWithinPasswordByteLimit(
  validationOptions?: ValidationOptions
): PropertyDecorator {
  return function (target: object, propertyKey: string | symbol) {
    registerDecorator({
      target: target.constructor,
      propertyName: String(propertyKey),
      options: validationOptions,
      validator: IsWithinPasswordByteLimitConstraint
    });
  };
}
