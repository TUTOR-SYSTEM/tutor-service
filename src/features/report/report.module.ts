import { Module } from '@nestjs/common';
import { UserModule } from '../user/user.module';
import { ReportController } from './report.controller';
import { ReportRpcController } from './report.rpc.controller';
import { ReportRepository } from './report.repository';
import { ReportService } from './report.service';

@Module({
  imports: [UserModule],
  controllers: [ReportController, ReportRpcController],
  providers: [ReportService, ReportRepository],
})
export class ReportModule {}
