import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { Access, CurrentPrincipal, RequestMeta, type RequestMetaInfo } from '../../common/decorators';
import type { Principal } from '../../common/principal';
import { ShiftsService } from './shifts.service';
import {
  CancelShiftDto, CoverageQuery, CreateShiftDto, CreateShiftTemplateDto, GenerateShiftsDto, ListShiftsQuery, StaffClockDto,
  UpdateShiftDto, UpdateShiftTemplateDto,
} from './dto/shifts.dto';

class TemplatesQuery {
  @ApiPropertyOptional({ enum: ['true', 'false'], default: 'false' })
  @IsOptional()
  @IsIn(['true', 'false'])
  includeInactive?: 'true' | 'false';
}

@ApiTags('Shifts')
@ApiBearerAuth()
@Controller({ path: 'shifts', version: '1' })
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Access({ actors: ['staff'], permissions: ['shifts.read'] })
  @Get('templates')
  templates(@Query() q: TemplatesQuery) {
    return this.shifts.listTemplates(q.includeInactive === 'true');
  }

  @Access({ actors: ['staff'], permissions: ['shifts.manage'] })
  @Post('templates')
  createTemplate(@Body() dto: CreateShiftTemplateDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.shifts.createTemplate(dto, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['shifts.manage'] })
  @Patch('templates/:id')
  updateTemplate(@Param('id') id: string, @Body() dto: UpdateShiftTemplateDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.shifts.updateTemplate(id, dto, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['shifts.manage'] })
  @Delete('templates/:id')
  @ApiOperation({ summary: 'Deactivate a template (existing shifts are kept)' })
  deactivateTemplate(@Param('id') id: string, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.shifts.deactivateTemplate(id, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['shifts.manage'] })
  @Post('generate')
  @ApiOperation({ summary: 'Book heroes on a template for a date range (skips duplicates/overlaps)' })
  generate(@Body() dto: GenerateShiftsDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.shifts.generate(dto, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['shifts.read'] })
  @Get('coverage')
  @ApiOperation({ summary: 'Required vs scheduled heroes per template per day' })
  coverage(@Query() q: CoverageQuery) {
    return this.shifts.coverage(q);
  }

  @Access({ actors: ['staff'], permissions: ['shifts.read'] })
  @Get()
  @ApiOperation({ summary: 'Shift calendar (default: current week)' })
  list(@Query() q: ListShiftsQuery) {
    return this.shifts.list(q);
  }

  @Access({ actors: ['staff'], permissions: ['shifts.manage'] })
  @Post()
  create(@Body() dto: CreateShiftDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.shifts.create(dto, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['shifts.read'] })
  @Get(':id')
  get(@Param('id') id: string) {
    return this.shifts.get(id);
  }

  @Access({ actors: ['staff'], permissions: ['shifts.manage'] })
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateShiftDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.shifts.update(id, dto, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['shifts.manage'] })
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string, @Body() dto: CancelShiftDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.shifts.cancel(id, dto.reason, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['shifts.manage'] })
  @Post(':id/clock-in')
  @HttpCode(200)
  @ApiOperation({ summary: 'Record a clock-in on the hero’s behalf (hub desk)' })
  clockIn(@Param('id') id: string, @Body() dto: StaffClockDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.shifts.clockIn(id, { at: dto.at ? new Date(dto.at) : undefined, lat: dto.lat, lng: dto.lng, note: dto.note }, { principal: p, meta });
  }

  @Access({ actors: ['staff'], permissions: ['shifts.manage'] })
  @Post(':id/clock-out')
  @HttpCode(200)
  @ApiOperation({ summary: 'Record a clock-out on the hero’s behalf (posts the shift earning)' })
  clockOut(@Param('id') id: string, @Body() dto: StaffClockDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.shifts.clockOut(id, { at: dto.at ? new Date(dto.at) : undefined, lat: dto.lat, lng: dto.lng, note: dto.note }, { principal: p, meta });
  }
}
