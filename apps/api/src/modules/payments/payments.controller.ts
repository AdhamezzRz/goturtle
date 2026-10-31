import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { IsBoolean, IsOptional } from 'class-validator';
import type { Response } from 'express';
import { Access, CurrentPrincipal, Public, RequestMeta, type RequestMetaInfo } from '../../common/decorators';
import type { Principal } from '../../common/principal';
import { PaymentsService, type PaymobTransaction } from './payments.service';

export class PaymentLinkDto {
  @ApiPropertyOptional({ default: false, description: 'Also send the link to the recipient by SMS' })
  @IsOptional()
  @IsBoolean()
  notifyCustomer?: boolean;
}

@ApiTags('Payments')
@Controller({ path: 'payments', version: '1' })
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @ApiBearerAuth()
  @Access({ actors: ['staff', 'brand'], permissions: ['orders.read'] })
  @Get('orders/:id')
  @ApiOperation({ summary: 'Online payment state of an order' })
  status(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.payments.status(p, id);
  }

  @ApiBearerAuth()
  @Access({ actors: ['staff', 'brand'], permissions: ['orders.update'] })
  @Post('orders/:id/link')
  @HttpCode(200)
  @ApiOperation({ summary: 'Create a Paymob checkout link for a COD order not yet out for delivery (PAYMENTS_DISABLED when off)' })
  link(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() dto: PaymentLinkDto, @RequestMeta() meta: RequestMetaInfo) {
    return this.payments.createLink(p, id, dto, meta);
  }

  /** Paymob "transaction processed" callback. */
  @Public()
  @SkipThrottle()
  @Post('paymob/callback')
  @HttpCode(200)
  callback(@Body() body: { type?: string; obj?: PaymobTransaction }, @Query('hmac') hmac?: string) {
    return this.payments.handleCallback(body, hmac);
  }

  /** Paymob "transaction response" browser redirect → back to the tracking page. */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('paymob/callback')
  async redirect(@Query() query: Record<string, string>, @Res() res: Response) {
    const out = await this.payments.handleRedirect(query);
    res.redirect(302, out.url);
  }
}
