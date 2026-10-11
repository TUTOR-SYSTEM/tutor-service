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
  type CreateChapterDto,
  type UpdateChapterDto,
  type GetChaptersQueryDto,
  createChapterSchema,
  updateChapterSchema,
  getChaptersQuerySchema,
} from '@packages/entities';
import { ChapterService } from './chapter.service';
import { ZodValidationPipe } from '@packages/pipes';

@ApiTags('Chapter')
@ApiBearerAuth('access-token')
@Controller('chapter')
export class ChapterController {
  constructor(private readonly chapterService: ChapterService) {}

  @Post(':curriculumId')
  @HttpCode(StatusCodes.CREATED)
  @ApiOperation({ summary: 'Create chapter', description: 'Create a new chapter for a curriculum' })
  @ApiParam({ name: 'curriculumId', description: 'Curriculum ID', type: 'string' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string', example: 'Chapter 1' },
        description: { type: 'string', example: '' },
        order: { type: 'number', example: 1 },
      },
    },
  })
  @SwaggerResponse({ status: StatusCodes.CREATED, description: 'Chapter created' })
  @ApiResponse({ statusCode: StatusCodes.CREATED, message: 'Create chapter successfully' })
  async createChapterController(
    @CurrentUser() user: Record<string, string>,
    @Param('curriculumId') curriculumId: string,
    @Body(new ZodValidationPipe<CreateChapterDto>(createChapterSchema)) data: CreateChapterDto,
  ) {
    return await this.chapterService.createChapterService({
      userId: user.id,
      curriculumId,
      data,
    });
  }

  @Get('')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({ summary: 'Get all chapters', description: 'Get all chapters for a curriculum' })
  @ApiQuery({ name: 'curriculumId', description: 'Curriculum ID', type: 'string', required: true })
  @ApiQuery({ name: 'page', description: 'Page number', type: 'number', required: false })
  @ApiQuery({ name: 'limit', description: 'Items per page', type: 'number', required: false })
  @SwaggerResponse({ status: StatusCodes.OK, description: 'Get all chapters' })
  @ApiResponse({ statusCode: StatusCodes.OK, message: 'Get all chapters successfully' })
  async getAllChaptersController(
    @Query(new ZodValidationPipe<GetChaptersQueryDto>(getChaptersQuerySchema))
    query: GetChaptersQueryDto,
  ) {
    return await this.chapterService.getAllChaptersService({ query });
  }

  @Get(':id')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({ summary: 'Get chapter by id' })
  @ApiParam({ name: 'id', description: 'Chapter ID', type: 'string' })
  @SwaggerResponse({ status: StatusCodes.OK, description: 'Get chapter by id' })
  @ApiResponse({ statusCode: StatusCodes.OK, message: 'Get chapter successfully' })
  async getChapterByIdController(@Param('id') id: string) {
    return await this.chapterService.getChapterByIdService({ id });
  }

  @Put(':id')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({ summary: 'Update chapter' })
  @ApiParam({ name: 'id', description: 'Chapter ID', type: 'string' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', example: 'Chapter 1' },
        description: { type: 'string', example: '' },
        order: { type: 'number', example: 1 },
      },
    },
  })
  @SwaggerResponse({ status: StatusCodes.OK, description: 'Update chapter' })
  @ApiResponse({ statusCode: StatusCodes.OK, message: 'Update chapter successfully' })
  async updateChapterController(
    @CurrentUser() user: Record<string, string>,
    @Param('id') id: string,
    @Body(new ZodValidationPipe<UpdateChapterDto>(updateChapterSchema)) data: UpdateChapterDto,
  ) {
    return await this.chapterService.updateChapterService({ userId: user.id, id, data });
  }

  @Delete(':id')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({ summary: 'Delete chapter' })
  @ApiParam({ name: 'id', description: 'Chapter ID', type: 'string' })
  @SwaggerResponse({ status: StatusCodes.OK, description: 'Delete chapter' })
  @ApiResponse({ statusCode: StatusCodes.OK, message: 'Delete chapter successfully' })
  async deleteChapterController(
    @CurrentUser() user: Record<string, string>,
    @Param('id') id: string,
  ) {
    return await this.chapterService.deleteChapterService({ userId: user.id, id });
  }
}
