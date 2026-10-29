import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Param,
  Post,
  Put,
  Query,
  Delete,
} from '@nestjs/common';
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
  type GetCurriculumsQueryDto,
  type CreateCurriculumDto,
  getCurriculumsQuerySchema,
} from '@packages/entities';
import { CurriculumService } from './curriculum.service';
import { ZodValidationPipe } from '@packages/pipes';
import { ParseUUIDPipe } from '@nestjs/common';

@ApiTags('Curriculum')
@ApiBearerAuth('access-token')
@Controller('curriculum')
export class CurriculumController {
  private readonly logger = new Logger(CurriculumController.name);
  constructor(private readonly curriculumService: CurriculumService) {}

  @Get('generate-code')
  @HttpCode(StatusCodes.CREATED)
  @ApiOperation({
    summary: 'Create curriculum code ...',
    description: 'Create new curriculum code...',
  })
  @SwaggerResponse({ status: StatusCodes.CREATED, description: 'Create curriculum code ...' })
  @ApiResponse({ statusCode: StatusCodes.CREATED, message: 'Create curriculum code ...' })
  async getNewCurrriculumCodeController() {
    return await this.curriculumService.generateNewCodeService();
  }
  @Post('')
  @HttpCode(StatusCodes.CREATED)
  @ApiOperation({
    summary: 'Create curriculum ...',
    description: 'Create new curriculum ...',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['subject', 'code', 'grade', 'courseTime'],
      properties: {
        subject: { type: 'string', example: 'Đại Số' },
        code: { type: 'string', example: 'FDV643' },
        grade: { type: 'string', example: '12' },
        description: { type: 'string', example: '' },
      },
    },
  })
  @SwaggerResponse({ status: StatusCodes.CREATED, description: 'Create curriculum ...' })
  @ApiResponse({ statusCode: StatusCodes.CREATED, message: 'Create curriculum ...' })
  async createCurriculumController(
    @Body() createCurriculum: CreateCurriculumDto,
    @CurrentUser() user: Record<string, string>,
  ) {
    return await this.curriculumService.createCurriculumService({
      userId: user.id,
      role: user.role,
      createCurriculum,
    });
  }

  @Get('')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({
    summary: 'Get all curriculum ...',
    description: 'Get all data curriculum ...',
  })
  @ApiQuery({ name: 'page', type: Number, required: false, example: 1 })
  @ApiQuery({ name: 'limit', type: Number, required: false, example: 10 })
  @ApiQuery({
    name: 'search',
    type: String,
    required: false,
    example: '',
    description: 'Search by subject or code',
  })
  @SwaggerResponse({ status: StatusCodes.OK, description: 'Get all curriculum ...' })
  @ApiResponse({ statusCode: StatusCodes.OK, message: 'Get all curriculum ...' })
  async getAllCurriculumController(
    @Query(new ZodValidationPipe<GetCurriculumsQueryDto>(getCurriculumsQuerySchema))
    query: GetCurriculumsQueryDto,
    @CurrentUser() user: Record<string, string>,
  ) {
    this.logger.log('userid', user.id);
    return await this.curriculumService.getAllCurriculumService({
      userId: user.id,
      role: user.role,
      query,
    });
  }

  @Get(':id')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({
    summary: 'Get curriculum by id ...',
    description: 'Get curriculum by id ...',
  })
  @ApiParam({ name: 'id', description: 'Curriculum ID', type: 'string' })
  @SwaggerResponse({ status: StatusCodes.OK, description: 'Get curriculum by id ...' })
  @ApiResponse({ statusCode: StatusCodes.OK, message: 'Get curriculum by id ...' })
  async getCurriculumByIdController(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: Record<string, string>,
  ) {
    return await this.curriculumService.getCurriculumByIdService({
      userId: user.id,
      role: user.role,
      id,
    });
  }

  @Put(':id')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({
    summary: 'Update curriculum ...',
    description: 'Update curriculum ...',
  })
  @ApiParam({ name: 'id', description: 'Curriculum ID', type: 'string' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        subject: { type: 'string', example: 'Đại Số' },
        code: { type: 'string', example: 'FDV643' },
        grade: { type: 'string', example: '12' },
        description: { type: 'string', example: '' },
      },
    },
  })
  @SwaggerResponse({ status: StatusCodes.OK, description: 'Update curriculum ...' })
  @ApiResponse({ statusCode: StatusCodes.OK, message: 'Update curriculum ...' })
  async updateCurriculumController(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateData: CreateCurriculumDto,
    @CurrentUser() user: Record<string, string>,
  ) {
    return await this.curriculumService.updateCurriculumService({
      userId: user?.id,
      role: user?.role,
      id,
      data: updateData,
    });
  }

  @Delete(':id')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({
    summary: 'Delete curriculum ...',
    description: 'Delete curriculum ...',
  })
  @ApiParam({ name: 'id', description: 'Curriculum ID', type: 'string' })
  @SwaggerResponse({ status: StatusCodes.OK, description: 'Delete curriculum ...' })
  @ApiResponse({ statusCode: StatusCodes.OK, message: 'Delete curriculum ...' })
  async deleteCurriculumController(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: Record<string, string>,
  ) {
    return await this.curriculumService.deleteCurriculumService({
      userId: user.id,
      role: user.role,
      id,
    });
  }
}
