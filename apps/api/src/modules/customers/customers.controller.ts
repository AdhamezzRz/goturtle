import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Access, CurrentPrincipal, RequestMeta, type RequestMetaInfo } from '../../common/decorators';
import type { Principal } from '../../common/principal';
import { CustomersService } from './customers.service';
import { BlockCustomerDto, CustomerListQuery } from './customers.dto';

@ApiTags('Customers')
@ApiBearerAuth()
@Controller({ path: 'customers', version: '1' })
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Access({ actors: ['staff'], permissions: ['orders.read'] })
  @Get()
  @ApiOperation({ summary: 'Search consignees by phone (any format) or name' })
  list(@Query() q: CustomerListQuery) {
    return this.customers.list(q);
  }

  @Access({ actors: ['staff'], permissions: ['orders.read'] })
  @Get(':id')
  @ApiOperation({ summary: 'Customer profile: stats, reliability and the 20 most recent orders' })
  detail(@Param('id') id: string) {
    return this.customers.detail(id);
  }

  @Access({ actors: ['staff'], permissions: ['orders.update'] })
  @Post(':id/block')
  @HttpCode(200)
  block(@Param('id') id: string, @Body() dto: BlockCustomerDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.customers.setBlocked(id, true, dto.reason, p, meta);
  }

  @Access({ actors: ['staff'], permissions: ['orders.update'] })
  @Post(':id/unblock')
  @HttpCode(200)
  unblock(@Param('id') id: string, @Body() dto: BlockCustomerDto, @CurrentPrincipal() p: Principal, @RequestMeta() meta: RequestMetaInfo) {
    return this.customers.setBlocked(id, false, dto.reason, p, meta);
  }
}
