import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import { FeatureController } from '../controllers/feature.controller';

@Injectable()
export class FeatureControllerGuard implements CanActivate {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const controllerClass = context.getClass(); // (we can use it in method guards as well)

    console.log('[FeatureControllerGuard] Controller class:', controllerClass);

    if (controllerClass === FeatureController) {
      console.log(
        '[FeatureControllerGuard] - We can allow routes of this controller',
      );

      // or we can throw new UnauthorizedException() / new ForbiddenException() otherwise
    }

    return true;
  }
}
