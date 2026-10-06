import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiQuery,
  ApiParam,
  ApiResponse as SwaggerResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { StatusCodes } from 'http-status-codes';
import { ZodValidationPipe } from '@packages/pipes';
import { CurrentUser } from '@packages/decorators';
import {
  createTuitionSchema,
  type CreateTuitionDto,
  getTuitionsQuerySchema,
  type GetTuitionsQueryDto,
  updateTuitionSchema,
  type UpdateTuitionDto,
} from '@packages/entities/tuition';
import { TuitionService } from './tuition.service';

@ApiTags('Tuitions')
@ApiBearerAuth('access-token')
@Controller('tuitions')
export class TuitionController {
  constructor(private readonly tuitionService: TuitionService) {}

  @Post()
  @HttpCode(StatusCodes.CREATED)
  @ApiOperation({ summary: 'Create tuition record' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['classId', 'studentId', 'amount'],
      properties: {
        classId: { type: 'string', format: 'uuid' },
        studentId: { type: 'string', format: 'uuid' },
        amount: { type: 'number', minimum: 0, example: 1500000 },
        dueDate: { type: 'string', format: 'date-time' },
        paidDate: { type: 'string', format: 'date-time' },
        status: { type: 'string', enum: ['PAID', 'UNPAID', 'OVERDUE'], default: 'UNPAID' },
        note: { type: 'string' },
      },
    },
  })
  @SwaggerResponse({ status: 201, description: 'Tuition record created' })
  async create(
    @Body(new ZodValidationPipe<CreateTuitionDto>(createTuitionSchema))
    dto: CreateTuitionDto,
    @CurrentUser() user: Record<string, string>,
  ) {
    return this.tuitionService.create(dto, user.id);
  }

  @Get()
  @HttpCode(StatusCodes.OK)
  @ApiOperation({ summary: 'List tuition records' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiQuery({ name: 'classId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'studentId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'status', required: false, enum: ['PAID', 'UNPAID', 'OVERDUE'] })
  @SwaggerResponse({ status: 200, description: 'Tuitions fetched' })
  async findAll(
    @Query(new ZodValidationPipe<GetTuitionsQueryDto>(getTuitionsQuerySchema))
    query: GetTuitionsQueryDto,
    @CurrentUser() user: Record<string, string>,
  ) {
    return this.tuitionService.findAll({ userId: user.id, query });
  }

  @Get('summary')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({
    summary: 'Tuition summary',
    description: 'Get revenue summary (total paid/unpaid/overdue/revenue)',
  })
  @ApiQuery({ name: 'classId', required: false, type: String, format: 'uuid' })
  @SwaggerResponse({ status: 200, description: 'Summary fetched' })
  async getSummary(
    @CurrentUser() user: Record<string, string>,
    @Query('classId') classId?: string,
  ) {
    return this.tuitionService.getSummary({ userId: user.id, classId });
  }

  @Get(':id')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({ summary: 'Get tuition detail' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @SwaggerResponse({ status: 200, description: 'Tuition detail' })
  async findById(@Param('id') id: string, @CurrentUser() user: Record<string, string>) {
    return this.tuitionService.findById({ userId: user.id, id });
  }

  @Put(':id')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({ summary: 'Update tuition record' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        amount: { type: 'number', minimum: 0 },
        dueDate: { type: 'string', format: 'date-time' },
        paidDate: { type: 'string', format: 'date-time' },
        status: { type: 'string', enum: ['PAID', 'UNPAID', 'OVERDUE'] },
        note: { type: 'string' },
      },
    },
  })
  @SwaggerResponse({ status: 200, description: 'Tuition updated' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTuitionSchema))
    dto: UpdateTuitionDto,
    @CurrentUser() user: Record<string, string>,
  ) {
    return this.tuitionService.update(id, dto, user.id);
  }

  @Delete(':id')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({ summary: 'Delete tuition record' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @SwaggerResponse({ status: 200, description: 'Tuition deleted' })
  async delete(@Param('id') id: string, @CurrentUser() user: Record<string, string>) {
    return this.tuitionService.delete(id, user.id);
  }
}
