import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface
} from 'class-validator';
import { findCustomQueryError } from '@app/shared/utils/mongo-query-safety';

@ValidatorConstraint({ name: 'isSafeMongoQuery', async: false })
export class IsSafeMongoQueryConstraint implements ValidatorConstraintInterface {
  private lastError = '';

  validate(value: unknown): boolean {
    if (value === undefined || value === null) {
      return true;
    }

    const error = findCustomQueryError(value);
    if (error) {
      this.lastError = error;
      return false;
    }

    return true;
  }

  defaultMessage(): string {
    return this.lastError || 'custom contains disallowed MongoQuery operators';
  }
}

export function IsSafeMongoQuery(
  validationOptions?: ValidationOptions
): PropertyDecorator {
  return function (target: object, propertyKey: string | symbol) {
    registerDecorator({
      target: target.constructor,
      propertyName: String(propertyKey),
      options: validationOptions,
      constraints: [],
      validator: IsSafeMongoQueryConstraint
    });
  };
}
