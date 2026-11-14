import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  MessageEvent,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  Sse
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';
import { EMPTY, Observable } from 'rxjs';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import { NotificationsService } from './notifications.service';
import { UserNotificationsService } from './user-notifications.service';
import { UserNotificationCursorQueryDto } from './dtos/user-notification-cursor-query.dto';
import { UserNotificationUnreadCountResponseDto } from './dtos/user-notification-response.dto';
import { JwtAuthRequest } from '../auth/types/auth.request';

@ApiTags('Notifications API')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Unauthorized' })
@Controller({
  path: 'notifications',
  version: '1'
})
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly userNotifications: UserNotificationsService
  ) {}

  @Get()
  @ApiOperation({
    summary: "The caller's stored notices, newest first (cursor-paginated)."
  })
  @ApiOkResponse({
    description: "Cursor-paginated list of the caller's notices"
  })
  list(
    @Req() req: JwtAuthRequest,
    @Query() query: UserNotificationCursorQueryDto
  ) {
    return this.userNotifications.list(req.user.userId, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: "The number of the caller's unread notices." })
  @ApiOkResponse({ type: UserNotificationUnreadCountResponseDto })
  unreadCount(@Req() req: JwtAuthRequest) {
    return this.userNotifications.unreadCount(req.user.userId);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark one notice of the caller as read.' })
  @ApiNoContentResponse({ description: 'The notice is read' })
  @ApiNotFoundResponse({ description: 'The caller has no notice with this id' })
  markRead(
    @Req() req: JwtAuthRequest,
    @Param('id', ParseUUIDPipe) id: string
  ): Promise<void> {
    return this.userNotifications.markRead(req.user.userId, id);
  }

  @Get('stream')
  @Sse()
  @ApiOperation({ summary: 'Subscribe to real-time server-sent events' })
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
