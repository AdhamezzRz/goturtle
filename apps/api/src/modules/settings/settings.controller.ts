import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Access, CurrentPrincipal, Public, RequestMeta, type RequestMetaInfo } from '../../common/decorators';
import type { Principal } from '../../common/principal';
import { SettingsService } from './settings.service';
import { AuditLogService } from './audit-log.service';
import { AuditQueryDto, UpdateSettingDto } from './settings.dto';

@ApiTags('Settings')
@ApiBearerAuth()
@Controller({ path: 'settings', version: '1' })
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Public()
  @Get('public')
  @ApiOperation({ summary: 'Company name, support contacts, logo and brand colour (no auth)' })
  publicSettings() {
    return this.settings.publicSettings();
  }

  @Access({ actors: ['staff'], permissions: ['settings.manage'] })
  @Get()
  @ApiOperation({ summary: 'All system settings with effective values and defaults' })
  list() {
    return this.settings.list();
  }

  @Access({ actors: ['staff'], permissions: ['settings.manage'] })
  @Get(':key')
  getOne(@Param('key') key: string) {
    return this.settings.getOne(key);
  }

  @Access({ actors: ['staff'], permissions: ['settings.manage'] })
  @Put(':key')
  @ApiOperation({ summary: 'Update a setting (partial; validated per field)' })
  update(@Param('key') key: string, @Body() dto: UpdateSettingDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.settings.setRaw(key, dto.value, p, meta);
  }
}

@ApiTags('Audit')
@ApiBearerAuth()
@Controller({ path: 'audit', version: '1' })
export class AuditController {
  constructor(private readonly audit: AuditLogService) {}

  @Access({ actors: ['staff'], permissions: ['audit.read'] })
  @Get()
  @ApiOperation({ summary: 'Audit trail viewer (filters: entity, entityId, actorId, action, from, to)' })
  list(@Query() q: AuditQueryDto) {
    return this.audit.list(q);
  }
}
