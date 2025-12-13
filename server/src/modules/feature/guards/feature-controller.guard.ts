import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { FeatureController } from '../controllers/feature.controller';
import { Reflector } from '@nestjs/core';
import { MetadataKeysEnum } from '../enums/metadata-keys.enum';
import { FeatureRolesEnum } from '../enums/feature-roles.enum';

@Injectable()
export class FeatureControllerGuard implements CanActivate {
  private readonly logger = new Logger(FeatureControllerGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(
    context: ExecutionContext
  ): boolean | Promise<boolean> | Observable<boolean> {
    const controllerClass = context.getClass();

    if (controllerClass === FeatureController) {
      this.logger.debug('Allowing routes of FeatureController');
    }

    const roles = this.reflector.get<FeatureRolesEnum[]>(
      MetadataKeysEnum.Roles,
      context.getHandler()
    );

    if (roles) {
      this.logger.debug(`Assigned roles: ${roles.join(', ')}`);
    }

    return true;
  }
}
