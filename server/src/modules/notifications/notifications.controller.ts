import {
  Controller,
  Get,
  MessageEvent,
  Req,
  Res,
  Sse,
  UseGuards
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';
import { interval, map, merge, Observable } from 'rxjs';
import { randomUUID } from 'crypto';

const HEARTBEAT_INTERVAL_MS = 30_000;
import type { Response } from 'express';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtAuthRequest } from '../auth/types/auth.request';

@ApiTags('Notifications API')
@Controller({
  path: 'notifications',
  version: '1'
})
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('stream')
  @UseGuards(JwtAuthGuard)
  @Sse()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Subscribe to real-time server-sent events' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  stream(
    @Req() req: JwtAuthRequest,
    @Res({ passthrough: true }) res: Response
  ): Observable<MessageEvent> {
    // NestJS's SseStream.pipe() sends headers (including X-Accel-Buffering: no)
    // before calling the controller via lazy Observable subscription, so
    // res.setHeader() must not be called here — it would throw ERR_HTTP_HEADERS_SENT.
    const connectionId = randomUUID();
    const subject = this.notificationsService.getOrCreateStream(
      req.user.userId,
      connectionId
    );
    res.on('close', () => {
      this.notificationsService.closeStream(req.user.userId, connectionId);
    });

    // Keep-alive heartbeat to prevent nginx/proxy idle timeout
    const heartbeat$ = interval(HEARTBEAT_INTERVAL_MS).pipe(
      map((): MessageEvent => ({ data: '' }))
    );

    return merge(subject.asObservable(), heartbeat$);
  }
}
