import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';

@Injectable()
export class FeatureMethodGuard implements CanActivate {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    // context can be HTTP as well as Websocket, Rpc, Graphql etc

    const request = context.getArgByIndex(0); // returns the request object when the index is set to 0
    const response = context.getArgByIndex(1); // returns the response object when the index is set to 1
    const next = context.getArgByIndex(2); // returns 'next' function of middleware when the index is set to 2

    if (typeof next === 'function') {
      console.log('[FeatureMethodGuard] Next function exists');
    }

    console.log('[FeatureMethodGuard] Request body: ', request.body); // contains body, params, headers, cookies etc
    console.log('[FeatureMethodGuard] Response status: ', response.statusCode);

    const [req, res] = context.getArgs(); // another approach to get request and response objects

    res.cookie('cookie', 'testCookieValue');
    console.log(
      '[FeatureMethodGuard] Headers:',
      JSON.stringify(res.getHeaders(), null, 2),
    );

    // getting HTTP only context
    const httpReq = context.switchToHttp().getRequest();
    const httpRes = context.switchToHttp().getResponse();
    const httpNext = context.switchToHttp().getNext();

    console.log(
      '[FeatureMethodGuard] User Agent:',
      httpReq.headers['user-agent'],
    );

    return true;
  }
}
