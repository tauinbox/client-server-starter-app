import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import { FeatureController } from '../controllers/feature.controller';
import { Reflector } from '@nestjs/core';
import { MetadataKeysEnum } from '../enums/metadata-keys.enum';
import { FeatureRolesEnum } from '../enums/feature-roles.enum';

@Injectable()
export class FeatureControllerGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  // Reflector allows access to metadata assigned to the methods or classes

  canActivate(
    context: ExecutionContext
  ): boolean | Promise<boolean> | Observable<boolean> {
    const controllerClass = context.getClass(); // (we can use it in method guards as well)

    console.log('[FeatureControllerGuard] Controller class:', controllerClass);

    if (controllerClass === FeatureController) {
      console.log(
        '[FeatureControllerGuard] We can allow routes of this controller'
      );

      // or we can throw new UnauthorizedException() / new ForbiddenException() otherwise
    }

    const roles = this.reflector.get<FeatureRolesEnum[]>(
      MetadataKeysEnum.Roles,
      context.getHandler()
    );

    if (roles) {
      // Here we have assigned metadata
      console.log('[FeatureControllerGuard] Assigned roles:', roles);
    }

    return true;
  }
}
