import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Access, CurrentPrincipal } from '../../common/decorators';
import { principalUserId, type Principal } from '../../common/principal';
import { NotificationsService } from './notifications.service';
import { AdminNotificationsQueryDto, MyNotificationsQueryDto } from './notifications.dto';

const USERS = { actors: ['staff', 'brand', 'courier'] as Array<'staff' | 'brand' | 'courier'> };

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Access(USERS)
  @Get()
  @ApiOperation({ summary: 'My in-app notifications (newest first) + unread count' })
  mine(@CurrentPrincipal() p: Principal, @Query() q: MyNotificationsQueryDto) {
    return this.notifications.listMine(principalUserId(p)!, q);
  }

  @Access(USERS)
  @Get('unread-count')
  @ApiOperation({ summary: 'Cheap poll endpoint for the bell badge' })
  unread(@CurrentPrincipal() p: Principal) {
    return this.notifications.unreadCount(principalUserId(p)!);
  }

  @Access(USERS)
  @Post('read-all')
  @HttpCode(200)
  readAll(@CurrentPrincipal() p: Principal) {
    return this.notifications.markAllRead(principalUserId(p)!);
  }

  @Access({ actors: ['staff'], permissions: ['audit.read'] })
  @Get('admin')
  @ApiOperation({ summary: 'Staff: message log (SMS / WhatsApp / e-mail / in-app) with filters' })
  admin(@Query() q: AdminNotificationsQueryDto) {
    return this.notifications.adminList(q);
  }

  @Access({ actors: ['staff'], permissions: ['audit.read'] })
  @Post('admin/:id/resend')
  @HttpCode(200)
  @ApiOperation({ summary: 'Staff: re-send a failed/sent SMS, WhatsApp or e-mail' })
  resend(@Param('id') id: string) {
    return this.notifications.resend(id);
  }

  @Access(USERS)
  @Post(':id/read')
  @HttpCode(200)
  read(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.notifications.markRead(principalUserId(p)!, id);
  }
}
