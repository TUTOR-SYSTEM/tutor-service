import { Module } from '@nestjs/common';
import { ClassController } from './class.controller';
import { ClassRpcController } from './class.rpc.controller';
import { ClassRepository } from './class.repository';
import { ClassService } from './class.service';
import { UserLinkClient } from './user-link.client';
import { NotificationModule } from '../notification/notification.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [NotificationModule, UserModule],
  controllers: [ClassController, ClassRpcController],
  providers: [ClassService, ClassRepository, UserLinkClient],
  exports: [ClassService],
})
export class ClassModule {}
