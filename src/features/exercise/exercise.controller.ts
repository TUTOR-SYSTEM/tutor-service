import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiResponse as SwaggerResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { StatusCodes } from 'http-status-codes';
import { ZodValidationPipe } from '@packages/pipes';
import { CurrentUser } from '@packages/decorators';
import {
  createExerciseSchema,
  getExerciseQuerySchema,
  gradeExerciseSchema,
  submitExerciseSchema,
  type CreateExerciseDto,
  type GradeExerciseDto,
  type SubmitExerciseDto,
  type getExerciseDto,
} from '@packages/entities/exercise';
import { ExerciseService } from './exercise.service';
import { EXERCISE_SWAGGER_MESSAGES } from 'src/data/swaggers/messages';
import { EXERCISE_SWAGGERS_DATA } from 'src/data/swaggers/data/exercise.swagger';
import { ParseUUIDPipe } from '@nestjs/common';

@ApiTags('Exercises')
@ApiBearerAuth('access-token')
@Controller('exercises')
export class ExerciseController {
  constructor(private readonly exerciseService: ExerciseService) {}

  // todo : student submits an exercise (first submission) ...
  @Post()
  @HttpCode(StatusCodes.CREATED)
  @ApiOperation({
    summary: EXERCISE_SWAGGER_MESSAGES.CREATE_EXERCISE_SUCCESS,
    description: 'Submit an exercise for a session/lesson',
  })
  @ApiBody({ schema: EXERCISE_SWAGGERS_DATA.CREATE_EXERCISE_SCHEMA })
  @SwaggerResponse({ status: StatusCodes.CREATED, description: 'Exercise submitted' })
  create(
    @CurrentUser() user: Record<string, string>,
    @Body(new ZodValidationPipe<CreateExerciseDto>(createExerciseSchema))
    dto: CreateExerciseDto,
  ) {
    return this.exerciseService.createExerciseService({
      userId: user?.id,
      role: user?.role,
      data: dto,
    });
  }

  // todo : list exercises reachable by the current user (as tutor or student) ...
  @Get()
  @HttpCode(StatusCodes.OK)
  @ApiOperation({
    summary: EXERCISE_SWAGGER_MESSAGES.GET_EXERCISES_SUCCESSFULLY,
    description: 'List exercises the current user owns (tutor) or submitted (student)',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'sessionId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'studentId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'classId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'tutorId', required: false, type: String, format: 'uuid' })
  @SwaggerResponse({
    status: StatusCodes.OK,
    description: EXERCISE_SWAGGER_MESSAGES.GET_EXERCISES_SUCCESSFULLY,
  })
  getAll(
    @CurrentUser() user: Record<string, string>,
    @Query(new ZodValidationPipe<getExerciseDto>(getExerciseQuerySchema))
    query: getExerciseDto,
  ) {
    return this.exerciseService.getExercisesService({ userId: user?.id, role: user?.role, query });
  }

  // todo : get an exercise submission by id ...
  @Get(':id')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({
    summary: EXERCISE_SWAGGER_MESSAGES.GET_EXERCISE_SUCCESSFULLY,
    description: 'Get an exercise submission by id',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @SwaggerResponse({
    status: StatusCodes.OK,
    description: EXERCISE_SWAGGER_MESSAGES.GET_EXERCISE_SUCCESSFULLY,
  })
  getDetail(@CurrentUser() user: Record<string, string>, @Param('id', ParseUUIDPipe) id: string) {
    return this.exerciseService.getExerciseService({ userId: user?.id, role: user?.role, id });
  }

  // todo : student re-submits their own (ungraded) work ...
  @Patch(':id/submit')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({
    summary: EXERCISE_SWAGGER_MESSAGES.SUBMIT_EXERCISE_SUCCESSFULLY,
    description: 'Re-submit the files of an existing (ungraded) exercise',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ schema: EXERCISE_SWAGGERS_DATA.SUBMIT_EXERCISE_SCHEMA })
  @SwaggerResponse({
    status: StatusCodes.OK,
    description: EXERCISE_SWAGGER_MESSAGES.SUBMIT_EXERCISE_SUCCESSFULLY,
  })
  submit(
    @CurrentUser() user: Record<string, string>,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe<SubmitExerciseDto>(submitExerciseSchema))
    dto: SubmitExerciseDto,
  ) {
    return this.exerciseService.submitExerciseService({
      userId: user?.id,
      role: user?.role,
      id,
      data: dto,
    });
  }

  // todo : tutor grades a submission ...
  @Patch(':id/grade')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({
    summary: EXERCISE_SWAGGER_MESSAGES.GRADE_EXERCISE_SUCCESSFULLY,
    description: 'Grade an exercise submission (score 0-10 + comment)',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ schema: EXERCISE_SWAGGERS_DATA.GRADE_EXERCISE_SCHEMA })
  @SwaggerResponse({
    status: StatusCodes.OK,
    description: EXERCISE_SWAGGER_MESSAGES.GRADE_EXERCISE_SUCCESSFULLY,
  })
  grade(
    @CurrentUser() user: Record<string, string>,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe<GradeExerciseDto>(gradeExerciseSchema))
    dto: GradeExerciseDto,
  ) {
    return this.exerciseService.gradeExerciseService({
      userId: user?.id,
      role: user?.role,
      id,
      data: dto,
    });
  }
}
