import { Controller, Get, MessageEvent, Req, Res, Sse } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';
import { EMPTY, Observable } from 'rxjs';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import { NotificationsService } from './notifications.service';
import { JwtAuthRequest } from '../auth/types/auth.request';

@ApiTags('Notifications API')
@Controller({
  path: 'notifications',
  version: '1'
})
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('stream')
  @Sse()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Subscribe to real-time server-sent events' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  stream(
    @Req() req: JwtAuthRequest,
    @Res({ passthrough: true }) res: Response
  ): Observable<MessageEvent> {
    // The client can leave while the guard runs. Nest and the close listener
    // below do not see that close, so the stream would stay registered.
    if (req.socket.destroyed) return EMPTY;
    const connectionId = randomUUID();
    res.on('close', () => {
      this.notificationsService.closeStream(req.user.userId, connectionId);
    });

    // The heartbeat also keeps nginx/proxy from closing an idle stream.
    return this.notificationsService.openStream(
      req.user.userId,
      req.user.sessionId,
      connectionId
    );
  }
}
