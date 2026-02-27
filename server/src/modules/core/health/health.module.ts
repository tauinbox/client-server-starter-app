import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { SmtpHealthIndicator } from './smtp.health';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [SmtpHealthIndicator]
})
export class HealthModule {}
