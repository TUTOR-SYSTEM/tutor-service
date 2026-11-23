import { Module } from '@nestjs/common';
import { SessionController } from './session.controller';
import { SessionRpcController } from './session.rpc.controller';
import { SessionRepository } from './session.repository';
import { SessionService } from './session.service';
import { ClassModule } from '../class/class.module';
import { LessonModule } from '../lesson/lesson.module';
import { NotificationModule } from '../notification/notification.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [NotificationModule, ClassModule, LessonModule, UserModule],
  controllers: [SessionController, SessionRpcController],
  providers: [SessionService, SessionRepository],
  exports: [SessionService],
})
export class SessionModule {}
