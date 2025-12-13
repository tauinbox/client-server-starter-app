import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request, Response } from 'express';

@Injectable()
export class FeatureMethodGuard implements CanActivate {
  private readonly logger = new Logger(FeatureMethodGuard.name);

  canActivate(
    context: ExecutionContext
  ): boolean | Promise<boolean> | Observable<boolean> {
    // context can be HTTP as well as Websocket, Rpc, Graphql etc
    const httpContext = context.switchToHttp(); // getting HTTP only context
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();

    /*
    // some examples:
    const request = context.getArgByIndex(0); // returns the request object when the index is set to 0, contains body, params, headers, cookies etc
    const response = context.getArgByIndex(1); // returns the response object when the index is set to 1
    const next = context.getArgByIndex(2); // returns 'next' function of middleware when the index is set to 2

    if (typeof next === 'function') {
      this.logger('[FeatureMethodGuard] Next function exists');
    }

    // const [req, res] = context.getArgs(); // another approach to get request and response objects
    */

    this.logger.debug(`Request body: ${JSON.stringify(request.body)}`);
    this.logger.debug(`Response status: ${response.statusCode}`);
    this.logger.debug(`User Agent: ${request.headers['user-agent']}`);

    response.cookie('cookie', 'testCookieValue');
    return true;
  }
}
