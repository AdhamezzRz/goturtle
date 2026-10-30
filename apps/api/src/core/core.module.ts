import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { JobsService } from './jobs.service';
import { OtpService } from './otp.service';
import { SequenceService } from './sequence.service';
import { StorageService } from './storage.service';
import { SystemController } from './system.controller';
import { FilesController } from './files.controller';

/** Cross-cutting services every feature module can inject. */
@Global()
@Module({
  controllers: [SystemController, FilesController],
  providers: [AuditService, JobsService, OtpService, SequenceService, StorageService],
  exports: [AuditService, JobsService, OtpService, SequenceService, StorageService],
})
export class CoreModule {}
