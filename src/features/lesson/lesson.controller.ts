import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse as SwaggerResponse,
  ApiBearerAuth,
  ApiBody,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { ApiResponse, CurrentUser } from '@packages/decorators';
import { StatusCodes } from 'http-status-codes';
import {
  type CreateLessonBodyDto,
  type UpdateLessonDto,
  type GetLessonsQueryDto,
  createLessonBodySchema,
  updateLessonSchema,
  getLessonsQuerySchema,
} from '@packages/entities';
import { LessonService } from './lesson.service';
import { ZodValidationPipe } from '@packages/pipes';
import { ParseUUIDPipe } from '@nestjs/common';

@ApiTags('Lesson')
@ApiBearerAuth('access-token')
@Controller('curriculum/lessons')
export class LessonController {
  constructor(private readonly lessonService: LessonService) {}

  @Post('')
  @HttpCode(StatusCodes.CREATED)
  @ApiOperation({ summary: 'Create lesson', description: 'Create a new lesson' })
  @ApiQuery({ name: 'curriculumId', description: 'Curriculum ID', type: 'string' })
  @ApiQuery({
    name: 'chapterId',
    description: 'Chapter ID (optional)',
    type: 'string',
    required: false,
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string', example: 'Lesson 1' },
        description: { type: 'string', example: '' },
        order: { type: 'number', example: 1 },
        theoryUrls: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'url', 'key'],
            properties: {
              name: { type: 'string', example: 'theory.pdf' },
              url: { type: 'string', example: 'https://cdn.example.com/theory.pdf' },
              key: { type: 'string', example: 'lessons/theory.pdf' },
            },
          },
        },
        exerciseUrls: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'url', 'key'],
            properties: {
              name: { type: 'string', example: 'exercise.pdf' },
              url: { type: 'string', example: 'https://cdn.example.com/exercise.pdf' },
              key: { type: 'string', example: 'lessons/exercise.pdf' },
            },
          },
        },
      },
    },
  })
  @SwaggerResponse({ status: StatusCodes.CREATED, description: 'Lesson created' })
  @ApiResponse({ statusCode: StatusCodes.CREATED, message: 'Create lesson successfully' })
  async createLessonController(
    @CurrentUser() user: Record<string, string>,
    @Query('curriculumId') curriculumId: string,
    @Query('chapterId') chapterId: string | undefined,
    @Body(new ZodValidationPipe<CreateLessonBodyDto>(createLessonBodySchema))
    data: CreateLessonBodyDto,
  ) {
    return await this.lessonService.createLessonService({
      userId: user.id,
      role: user.role,
      curriculumId,
      chapterId,
      data,
    });
  }

  @Get('')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({
    summary: 'Get all lessons',
    description: 'Get lessons filtered by curriculumId and optionally chapterId',
  })
  @SwaggerResponse({ status: StatusCodes.OK, description: 'Get all lessons' })
  @ApiResponse({ statusCode: StatusCodes.OK, message: 'Get all lessons successfully' })
  async getAllLessonsController(
    @Query(new ZodValidationPipe<GetLessonsQueryDto>(getLessonsQuerySchema))
    query: GetLessonsQueryDto,
  ) {
    return await this.lessonService.getAllLessonsService({ query });
  }

  @Get(':id')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({ summary: 'Get lesson by id' })
  @ApiParam({ name: 'id', description: 'Lesson ID', type: 'string' })
  @SwaggerResponse({ status: StatusCodes.OK, description: 'Get lesson by id' })
  @ApiResponse({ statusCode: StatusCodes.OK, message: 'Get lesson successfully' })
  async getLessonByIdController(@Param('id', ParseUUIDPipe) id: string) {
    return await this.lessonService.getLessonByIdService({ id });
  }

  @Put(':id')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({ summary: 'Update lesson' })
  @ApiParam({ name: 'id', description: 'Lesson ID', type: 'string' })
  @SwaggerResponse({ status: StatusCodes.OK, description: 'Update lesson' })
  @ApiResponse({ statusCode: StatusCodes.OK, message: 'Update lesson successfully' })
  async updateLessonController(
    @CurrentUser() user: Record<string, string>,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe<UpdateLessonDto>(updateLessonSchema)) data: UpdateLessonDto,
  ) {
    return await this.lessonService.updateLessonService({
      userId: user.id,
      role: user.role,
      id,
      data,
    });
  }

  @Delete(':id')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({ summary: 'Delete lesson' })
  @ApiParam({ name: 'id', description: 'Lesson ID', type: 'string' })
  @SwaggerResponse({ status: StatusCodes.OK, description: 'Delete lesson' })
  @ApiResponse({ statusCode: StatusCodes.OK, message: 'Delete lesson successfully' })
  async deleteLessonController(
    @CurrentUser() user: Record<string, string>,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return await this.lessonService.deleteLessonService({ userId: user.id, role: user.role, id });
  }
}
