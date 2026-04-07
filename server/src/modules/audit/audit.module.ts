import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { AuditService } from './audit.service';
import { AuditCleanupService } from './audit-cleanup.service';
import { AuditLogInterceptor } from './interceptors/audit-log.interceptor';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  providers: [
    AuditService,
    AuditCleanupService,
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditLogInterceptor
    }
  ],
  exports: [AuditService]
})
export class AuditModule {}
