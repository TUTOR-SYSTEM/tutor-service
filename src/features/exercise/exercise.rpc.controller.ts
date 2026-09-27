import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import type {
  CreateExerciseDto,
  getExerciseDto,
  GradeExerciseDto,
  SubmitExerciseDto,
} from '@packages/entities/exercise';
import { ExerciseService } from './exercise.service';

/**
 * Message-pattern mirror of `ExerciseController` — reached only by the gateway's `TUTOR_SERVICE`
 * `ClientProxy` over RabbitMQ. Delegates to the same, unmodified
 * `ExerciseService` the HTTP controller uses; no business logic lives here.
 */
@Controller()
export class ExerciseRpcController {
  constructor(private readonly exerciseService: ExerciseService) {}

  @MessagePattern('exercise.create')
  create(@Payload() payload: { userId: string; data: CreateExerciseDto }) {
    return this.exerciseService.createExerciseService(payload);
  }

  @MessagePattern('exercise.getAll')
  getAll(@Payload() payload: { userId: string; query: getExerciseDto }) {
    return this.exerciseService.getExercisesService(payload);
  }

  @MessagePattern('exercise.getById')
  getById(@Payload() payload: { userId: string; id: string }) {
    return this.exerciseService.getExerciseService(payload);
  }

  @MessagePattern('exercise.submit')
  submit(@Payload() payload: { userId: string; id: string; data: SubmitExerciseDto }) {
    return this.exerciseService.submitExerciseService(payload);
  }

  @MessagePattern('exercise.grade')
  grade(@Payload() payload: { userId: string; id: string; data: GradeExerciseDto }) {
    return this.exerciseService.gradeExerciseService(payload);
  }
}