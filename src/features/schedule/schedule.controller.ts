import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
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
  createScheduleSchema,
  createSchedulesSchema,
  getSchedulesSchema,
  updateScheduleSchema,
  type CreateScheduleDto,
  type CreateSchedulesDto,
  type GetSchedulesQueryDto,
  type UpdateScheduleDto,
} from '@packages/entities/schedule';
import { ScheduleService } from './schedule.service';
import { SCHEDULE_SWAGGERS_DATA } from 'src/data/swaggers/data/schedule.swagger';
import { ParseUUIDPipe } from '@nestjs/common';

@ApiTags('Schedules')
@ApiBearerAuth('access-token')
@Controller('schedule')
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  // todo : create a single weekly schedule slot ...
  @Post('create')
  @HttpCode(StatusCodes.CREATED)
  @ApiOperation({ summary: 'Create schedule', description: 'Create a single weekly class slot' })
  @ApiBody({ schema: SCHEDULE_SWAGGERS_DATA.CREATE_SCHEDULE_SCHEMA })
  @SwaggerResponse({ status: StatusCodes.CREATED, description: 'Schedule created' })
  create(
    @Body(new ZodValidationPipe<CreateScheduleDto>(createScheduleSchema))
    dto: CreateScheduleDto,
    @CurrentUser() user: Record<string, string>,
  ) {
    return this.scheduleService.createScheduleService({
      userId: user?.id,
      role: user?.role,
      data: dto,
    });
  }

  // todo : bulk create weekly schedule slots for a class ...
  @Post('createBulk')
  @HttpCode(StatusCodes.CREATED)
  @ApiOperation({
    summary: 'Create schedules (bulk)',
    description: 'Create 1-7 weekly class slots at once',
  })
  @ApiBody({ schema: SCHEDULE_SWAGGERS_DATA.CREATE_SCHEDULES_SCHEMA })
  @SwaggerResponse({ status: StatusCodes.CREATED, description: 'Schedules created' })
  createBulk(
    @Body(new ZodValidationPipe<CreateSchedulesDto>(createSchedulesSchema))
    dto: CreateSchedulesDto,
    @CurrentUser() user: Record<string, string>,
  ) {
    return this.scheduleService.createSchedulesService({
      userId: user?.id,
      role: user?.role,
      data: dto,
    });
  }

  // todo : list all schedules the current user can access (owned or enrolled classes) ...
  @Get('getAll')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({
    summary: 'Get schedules',
    description: 'List schedules across the classes the current user owns or is enrolled in',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'classId', required: false, type: String, format: 'uuid' })
  @SwaggerResponse({ status: StatusCodes.OK, description: 'Schedules fetched' })
  getAll(
    @CurrentUser() user: Record<string, string>,
    @Query(new ZodValidationPipe<GetSchedulesQueryDto>(getSchedulesSchema))
    query: GetSchedulesQueryDto,
  ) {
    return this.scheduleService.getSchedulesService({ userId: user?.id, role: user?.role, query });
  }

  // todo : list all schedules of a class ...
  @Get('getByClass/:classId')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({ summary: 'Get schedules by class', description: 'List schedules of a class' })
  @ApiParam({ name: 'classId', type: String, format: 'uuid' })
  @SwaggerResponse({ status: StatusCodes.OK, description: 'Schedules fetched' })
  getByClass(
    @CurrentUser() user: Record<string, string>,
    @Param('classId', ParseUUIDPipe) classId: string,
  ) {
    return this.scheduleService.getSchedulesByClassService({
      userId: user?.id,
      role: user?.role,
      classId,
    });
  }

  // todo : get schedule detail ...
  @Get('getById/:id')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({ summary: 'Get schedule', description: 'Get a schedule by id' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @SwaggerResponse({ status: StatusCodes.OK, description: 'Schedule fetched' })
  getDetail(@CurrentUser() user: Record<string, string>, @Param('id', ParseUUIDPipe) id: string) {
    return this.scheduleService.getScheduleService({ userId: user?.id, role: user?.role, id });
  }

  // todo : update schedule ...
  @Patch('update/:id')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({ summary: 'Update schedule', description: 'Update a schedule by id' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ schema: SCHEDULE_SWAGGERS_DATA.UPDATE_SCHEDULE_SCHEMA })
  @SwaggerResponse({ status: StatusCodes.OK, description: 'Schedule updated' })
  update(
    @CurrentUser() user: Record<string, string>,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe<UpdateScheduleDto>(updateScheduleSchema))
    dto: UpdateScheduleDto,
  ) {
    return this.scheduleService.updateScheduleService({
      userId: user?.id,
      role: user?.role,
      id,
      data: dto,
    });
  }

  // todo : delete schedule ...
  @Delete('delete/:id')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({ summary: 'Delete schedule', description: 'Delete a schedule by id' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @SwaggerResponse({ status: StatusCodes.OK, description: 'Schedule deleted' })
  del(@CurrentUser() user: Record<string, string>, @Param('id', ParseUUIDPipe) id: string) {
    return this.scheduleService.delScheduleService({ userId: user?.id, role: user?.role, id });
  }
}
