import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface
} from 'class-validator';
import { validateMongoQueryKeys } from '@app/shared/utils/mongo-query-safety';

@ValidatorConstraint({ name: 'isSafeMongoQuery', async: false })
export class IsSafeMongoQueryConstraint implements ValidatorConstraintInterface {
  private lastError = '';

  validate(value: unknown): boolean {
    if (value === undefined || value === null) {
      return true;
    }

    if (typeof value !== 'string') {
      this.lastError = 'custom must be a JSON string';
      return false;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      this.lastError = 'custom must be valid JSON';
      return false;
    }

    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      this.lastError = 'custom must be a JSON object';
      return false;
    }

    const error = validateMongoQueryKeys(parsed, '');
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
