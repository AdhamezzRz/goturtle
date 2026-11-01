import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { NetworkModule } from '../network/network.module';
import { AddressBookController } from './address-book.controller';
import { AddressBookService } from './address-book.service';

/**
 * Address intelligence: per-customer address book, verified pin reuse,
 * location requests and the geocoder fallback.
 */
@Module({
  imports: [OrdersModule, NetworkModule],
  controllers: [AddressBookController],
  providers: [AddressBookService],
  exports: [AddressBookService],
})
export class AddressBookModule {}
