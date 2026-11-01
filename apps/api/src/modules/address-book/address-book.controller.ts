import { Controller, ForbiddenException, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Access, CurrentPrincipal } from '../../common/decorators';
import { brandScope, type Principal } from '../../common/principal';
import { AddressBookService } from './address-book.service';
import { AddressSuggestQuery } from './address-book.dto';

@ApiTags('Address book')
@ApiBearerAuth()
@Controller({ version: '1' })
export class AddressBookController {
  constructor(private readonly book: AddressBookService) {}

  @Access({ actors: ['staff'], permissions: ['orders.read'] })
  @Get('customers/:id/addresses')
  @ApiOperation({ summary: "Staff: the customer's address book (pins, verification, usage)" })
  addresses(@Param('id') id: string) {
    return this.book.listForCustomer(id);
  }

  @Access({ actors: ['brand', 'apiKey'], permissions: ['orders.create'] })
  @Get('address-book/suggest')
  @ApiOperation({ summary: 'Brand: addresses this brand already used for a phone + whether a verified pin exists (no coordinates, no other brands)' })
  suggest(@Query() q: AddressSuggestQuery, @CurrentPrincipal() p: Principal) {
    const brandId = brandScope(p);
    if (!brandId) throw new ForbiddenException('Brand account required');
    return this.book.suggest(brandId, q.phone);
  }
}
