import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AllExceptionsFilter } from './common/exceptions.filter';
import { CoreModule } from './core/core.module';
import { DatabaseModule } from './core/database.module';
import { BootstrapService } from './core/bootstrap.service';
import { LedgerModule } from './core/ledger/ledger.module';
import { AuthModule } from './modules/auth/auth.module';
import { NetworkModule } from './modules/network/network.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { CustomersModule } from './modules/customers/customers.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PickupsModule } from './modules/pickups/pickups.module';
import { DispatchModule } from './modules/dispatch/dispatch.module';
import { HeroTasksModule } from './modules/hero-tasks/hero-tasks.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { CouriersModule } from './modules/couriers/couriers.module';
import { HeroModule } from './modules/hero/hero.module';
import { ShiftsModule } from './modules/shifts/shifts.module';
import { CashModule } from './modules/cash/cash.module';
import { FinanceModule } from './modules/finance/finance.module';
import { GamificationModule } from './modules/gamification/gamification.module';
import { UsersModule } from './modules/users/users.module';
import { BrandsModule } from './modules/brands/brands.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { SettingsModule } from './modules/settings/settings.module';
import { PaymentsModule } from './modules/payments/payments.module';

@Module({
  imports: [
    EventEmitterModule.forRoot({ wildcard: false, maxListeners: 50, ignoreErrors: false }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 600 }]),
    DatabaseModule,
    CoreModule,
    LedgerModule,
    AuthModule,
    NetworkModule,
    PricingModule,
    CustomersModule,
    OrdersModule,
    PickupsModule,
    DispatchModule,
    HeroTasksModule,
    TrackingModule,
    CouriersModule,
    HeroModule,
    ShiftsModule,
    CashModule,
    FinanceModule,
    GamificationModule,
    UsersModule,
    BrandsModule,
    ApiKeysModule,
    WebhooksModule,
    NotificationsModule,
    IntegrationsModule,
    TicketsModule,
    AnalyticsModule,
    SettingsModule,
    PaymentsModule,
  ],
  providers: [
    BootstrapService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
