import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Access, CurrentPrincipal, RequestMeta, type RequestMetaInfo } from '../../common/decorators';
import type { Principal } from '../../common/principal';
import { UsersService } from './users.service';
import { requireBrandId, requireBrandOwner } from './access';
import { InviteStaffDto, InviteTeamMemberDto, UpdateStaffDto, UpdateTeamMemberDto, UsersQueryDto } from './users.dto';

@ApiTags('Users')
@ApiBearerAuth()
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Access({ actors: ['staff'], permissions: ['users.read'] })
  @Get()
  @ApiOperation({ summary: 'List users (default: staff) with role / status / hub / brand filters and search' })
  list(@Query() q: UsersQueryDto) {
    return this.users.list(q);
  }

  @Access({ actors: ['staff'], permissions: ['users.read'] })
  @Get(':id')
  get(@Param('id') id: string) {
    return this.users.get(id);
  }

  @Access({ actors: ['staff'], permissions: ['users.manage'] })
  @Post()
  @ApiOperation({ summary: 'Invite a staff user — the temporary password is returned once and sent by SMS' })
  invite(@Body() dto: InviteStaffDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.users.inviteStaff(dto, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['users.manage'] })
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateStaffDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.users.updateStaff(id, dto, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['users.manage'] })
  @Post(':id/reset-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Issue a new temporary password (signs the user out everywhere)' })
  resetPassword(@Param('id') id: string, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.users.resetPassword(id, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['users.manage'] })
  @Post(':id/suspend')
  @HttpCode(200)
  suspend(@Param('id') id: string, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.users.setStatus(id, 'SUSPENDED', p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['users.manage'] })
  @Post(':id/reactivate')
  @HttpCode(200)
  reactivate(@Param('id') id: string, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.users.setStatus(id, 'ACTIVE', p, meta);
  }
}

@ApiTags('Brand portal')
@ApiBearerAuth()
@Controller({ path: 'brands/me/team', version: '1' })
export class BrandTeamController {
  constructor(private readonly users: UsersService) {}

  @Access({ actors: ['brand'], permissions: ['users.read'] })
  @Get()
  @ApiOperation({ summary: 'Brand owner: my team' })
  list(@CurrentPrincipal() p: Principal) {
    return this.users.listTeam(requireBrandId(p));
  }

  @Access({ actors: ['brand'], permissions: ['users.manage'] })
  @Post()
  @ApiOperation({ summary: 'Brand owner: invite a team member (temporary password returned once)' })
  invite(@Body() dto: InviteTeamMemberDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.users.inviteTeamMember(requireBrandOwner(p).brandId, dto, p, meta);
  }

  @Access({ actors: ['brand'], permissions: ['users.manage'] })
  @Patch(':userId')
  update(@Param('userId') userId: string, @Body() dto: UpdateTeamMemberDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.users.updateTeamMember(requireBrandOwner(p).brandId, userId, dto, p, meta);
  }

  @Access({ actors: ['brand'], permissions: ['users.manage'] })
  @Delete(':userId')
  remove(@Param('userId') userId: string, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.users.removeTeamMember(requireBrandOwner(p).brandId, userId, p, meta);
  }
}
