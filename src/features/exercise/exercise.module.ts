import { Module } from '@nestjs/common';
import { ExerciseController } from './exercise.controller';
import { ExerciseRpcController } from './exercise.rpc.controller';
import { ExerciseRepository } from './exercise.repository';
import { ExerciseService } from './exercise.service';
import { UserModule } from '../user/user.module';
import { SessionModule } from '../session/session.module';
import { LessonModule } from '../lesson/lesson.module';
import { ClassModule } from '../class/class.module';

@Module({
  imports: [UserModule, SessionModule, LessonModule, ClassModule],
  controllers: [ExerciseController, ExerciseRpcController],
  providers: [ExerciseService, ExerciseRepository],
  exports: [ExerciseService],
})
export class ExerciseModule {}
