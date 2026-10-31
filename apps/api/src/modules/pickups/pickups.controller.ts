import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Access, CurrentPrincipal, RequestMeta, type RequestMetaInfo } from '../../common/decorators';
import type { Principal } from '../../common/principal';
import { PickupsService } from './pickups.service';
import { AssignPickupDto, CancelPickupDto, PickupListQuery, RequestPickupDto } from './pickups.dto';

@ApiTags('Pickups')
@ApiBearerAuth()
@Controller({ path: 'pickups', version: '1' })
export class PickupsController {
  constructor(private readonly pickups: PickupsService) {}

  @Access({ actors: ['staff', 'brand', 'apiKey'], permissions: ['pickups.manage'] })
  @Post()
  @ApiOperation({ summary: "Request a pickup; the brand's waiting CREATED orders at that location are attached" })
  request(@Body() dto: RequestPickupDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.pickups.request(dto, p, meta);
  }

  @Access({ actors: ['staff', 'brand', 'apiKey'], permissions: ['pickups.read'] })
  @Get()
  list(@Query() q: PickupListQuery, @CurrentPrincipal() p: Principal) {
    return this.pickups.list(q, p);
  }

  @Access({ actors: ['staff', 'brand', 'apiKey'], permissions: ['pickups.read'] })
  @Get(':id')
  detail(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.pickups.detail(id, p);
  }

  @Access({ actors: ['staff', 'brand', 'apiKey'], permissions: ['pickups.manage'] })
  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel while REQUESTED / ASSIGNED; attached orders are released' })
  cancel(@Param('id') id: string, @Body() dto: CancelPickupDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.pickups.cancel(id, dto.reason, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['pickups.manage'] })
  @Post(':id/assign')
  @HttpCode(200)
  @ApiOperation({ summary: 'Assign or reassign the pickup hero (orders → PICKUP_ASSIGNED)' })
  assign(@Param('id') id: string, @Body() dto: AssignPickupDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.pickups.assign(id, dto.courierId, p, meta);
  }
}
