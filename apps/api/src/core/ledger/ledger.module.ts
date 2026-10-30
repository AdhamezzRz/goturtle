import { Global, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { PostingsService } from './postings.service';

@Global()
@Module({ providers: [LedgerService, PostingsService], exports: [LedgerService, PostingsService] })
export class LedgerModule implements OnApplicationBootstrap {
  constructor(private readonly ledger: LedgerService) {}
  async onApplicationBootstrap() {
    await this.ledger.ensureChartOfAccounts();
  }
}
