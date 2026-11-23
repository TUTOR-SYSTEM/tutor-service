import { Module } from '@nestjs/common';
import { TutorSettingsRpcController } from './tutor-settings.rpc.controller';
import { TutorSettingsRepository } from './tutor-settings.repository';
import { TutorSettingsService } from './tutor-settings.service';

@Module({
  controllers: [TutorSettingsRpcController],
  providers: [TutorSettingsService, TutorSettingsRepository],
  exports: [TutorSettingsService],
})
export class TutorSettingsModule {}
