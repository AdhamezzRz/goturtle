import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Access, CurrentPrincipal, RequestMeta, type RequestMetaInfo } from '../../common/decorators';
import type { Principal } from '../../common/principal';
import { TicketsService } from './tickets.service';
import { AssignTicketDto, CreateTicketDto, ReplyTicketDto, TicketStatusDto, TicketsQueryDto, UpdateTicketDto } from './tickets.dto';

/** Everyone who can talk to support. Permissions apply to staff, brand users and API keys (customers are scoped to their own tickets). */
const READERS = ['staff', 'brand', 'apiKey', 'customer'] as Array<'staff' | 'brand' | 'apiKey' | 'customer'>;

@ApiTags('Tickets')
@ApiBearerAuth()
@Controller({ path: 'tickets', version: '1' })
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Access({ actors: READERS, permissions: ['tickets.manage'] })
  @Post()
  @ApiOperation({ summary: 'Open a ticket (staff, brand, API key, or customer for their own shipment)' })
  create(@CurrentPrincipal() p: Principal, @Body() dto: CreateTicketDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.tickets.create(p, dto, meta);
  }

  @Access({ actors: READERS, permissions: ['tickets.read'] })
  @Get()
  @ApiOperation({ summary: 'List tickets (filters: status, open, priority, category, assigneeId|me|none, brandId, orderId, breached, q)' })
  list(@CurrentPrincipal() p: Principal, @Query() q: TicketsQueryDto) {
    return this.tickets.list(p, q);
  }

  @Access({ actors: READERS, permissions: ['tickets.read'] })
  @Get(':id')
  @ApiOperation({ summary: 'Ticket with its messages (internal notes only for staff)' })
  detail(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.tickets.detail(p, id);
  }

  @Access({ actors: READERS, permissions: ['tickets.manage'] })
  @Post(':id/messages')
  @ApiOperation({ summary: 'Reply (staff may add internal notes with isInternal: true)' })
  reply(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() dto: ReplyTicketDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.tickets.reply(p, id, dto, meta);
  }

  @Access({ actors: READERS, permissions: ['tickets.manage'] })
  @Post(':id/status')
  @HttpCode(200)
  @ApiOperation({ summary: 'Change status (brands/customers: RESOLVED or CLOSED only)' })
  status(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() dto: TicketStatusDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.tickets.setStatus(p, id, dto.status, meta);
  }

  @Access({ actors: ['staff'], permissions: ['tickets.manage'] })
  @Post(':id/assign')
  @HttpCode(200)
  assign(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() dto: AssignTicketDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.tickets.assign(p, id, dto, meta);
  }

  @Access({ actors: ['staff'], permissions: ['tickets.manage'] })
  @Patch(':id')
  @ApiOperation({ summary: 'Staff: change subject, category or priority (priority recomputes the SLA)' })
  update(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() dto: UpdateTicketDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.tickets.update(p, id, dto, meta);
  }
}
