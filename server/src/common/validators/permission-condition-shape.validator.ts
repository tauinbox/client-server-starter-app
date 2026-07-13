import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface
} from 'class-validator';
import {
  findFieldMatchShapeError,
  findOwnershipShapeError,
  findUserAttrShapeError
} from '@app/shared/utils/permission-condition-shape';

type ShapeFinder = (value: unknown) => string | null;

@ValidatorConstraint({ name: 'permissionConditionShape', async: false })
export class PermissionConditionShapeConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    if (value === undefined || value === null) {
      return true;
    }
    const finder = args.constraints[0] as ShapeFinder;
    return finder(value) === null;
  }

  defaultMessage(args: ValidationArguments): string {
    const finder = args.constraints[0] as ShapeFinder;
    return finder(args.value) ?? 'invalid condition shape';
  }
}

function conditionShapeDecorator(
  finder: ShapeFinder,
  validationOptions?: ValidationOptions
): PropertyDecorator {
  return function (target: object, propertyKey: string | symbol) {
    registerDecorator({
      target: target.constructor,
      propertyName: String(propertyKey),
      options: validationOptions,
      constraints: [finder],
      validator: PermissionConditionShapeConstraint
    });
  };
}

export function IsOwnershipShape(
  validationOptions?: ValidationOptions
): PropertyDecorator {
  return conditionShapeDecorator(findOwnershipShapeError, validationOptions);
}

export function IsFieldMatchShape(
  validationOptions?: ValidationOptions
): PropertyDecorator {
  return conditionShapeDecorator(findFieldMatchShapeError, validationOptions);
}

export function IsUserAttrShape(
  validationOptions?: ValidationOptions
): PropertyDecorator {
  return conditionShapeDecorator(findUserAttrShapeError, validationOptions);
}
