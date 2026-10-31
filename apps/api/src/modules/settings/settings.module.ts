import { Global, Module } from '@nestjs/common';
import { AuditController, SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { AuditLogService } from './audit-log.service';

/** Global so any module can inject SettingsService. */
@Global()
@Module({
  controllers: [SettingsController, AuditController],
  providers: [SettingsService, AuditLogService],
  exports: [SettingsService],
})
export class SettingsModule {}
