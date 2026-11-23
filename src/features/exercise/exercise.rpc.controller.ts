import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import type {
  CreateExerciseDto,
  getExerciseDto,
  GradeExerciseDto,
  RequestResubmitExerciseDto,
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
  create(@Payload() payload: { userId: string; role?: string; data: CreateExerciseDto }) {
    return this.exerciseService.createExerciseService(payload);
  }

  @MessagePattern('exercise.getAll')
  getAll(@Payload() payload: { userId: string; role?: string; query: getExerciseDto }) {
    return this.exerciseService.getExercisesService(payload);
  }

  @MessagePattern('exercise.getById')
  getById(@Payload() payload: { userId: string; role?: string; id: string }) {
    return this.exerciseService.getExerciseService(payload);
  }

  @MessagePattern('exercise.submit')
  submit(
    @Payload() payload: { userId: string; role?: string; id: string; data: SubmitExerciseDto },
  ) {
    return this.exerciseService.submitExerciseService(payload);
  }

  @MessagePattern('exercise.grade')
  grade(@Payload() payload: { userId: string; role?: string; id: string; data: GradeExerciseDto }) {
    return this.exerciseService.gradeExerciseService(payload);
  }

  @MessagePattern('exercise.requestResubmit')
  requestResubmit(
    @Payload()
    payload: {
      userId: string;
      role?: string;
      id: string;
      data: RequestResubmitExerciseDto;
    },
  ) {
    return this.exerciseService.requestResubmitService(payload);
  }

  /** Gateway → kiểm tra quyền tải file trước khi xin presigned URL từ service upload. */
  @MessagePattern('exercise.fileAccess')
  fileAccess(@Payload() payload: { key: string; userId: string; role?: string | null }) {
    return this.exerciseService.canAccessFileService(payload);
  }
}
