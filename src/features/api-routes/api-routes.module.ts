import { Module } from '@nestjs/common';
import { ApiRoutesRpcController } from './api-routes.rpc.controller';
import { ApiRoutesRepository } from './api-routes.repository';
import { ApiRoutesService } from './api-routes.service';

@Module({
  controllers: [ApiRoutesRpcController],
  providers: [ApiRoutesService, ApiRoutesRepository],
})
export class ApiRoutesModule {}
