import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
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
  createSessionSchema,
  createSessionsSchema,
  getSessionsSchema,
  updateSessionSchema,
  type CreateSessionDto,
  type CreateSessionsDto,
  type GetSessionsQueryDto,
  type UpdateSessionDto,
} from '@packages/entities/session';
import { SessionService } from './session.service';
import { SESSION_SWAGGER_MESSAGES } from 'src/data/swaggers/messages';
import { SESSION_SWAGGERS_DATA } from 'src/data/swaggers/data/session.swagger';
import { ParseUUIDPipe } from '@nestjs/common';

@ApiTags('Sessions')
@ApiBearerAuth('access-token')
@Controller('sessions')
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  // todo : create a single class session ...
  @Post()
  @HttpCode(StatusCodes.CREATED)
  @ApiOperation({
    summary: SESSION_SWAGGER_MESSAGES.CREATE_SESSION_SUCCESS,
    description: 'Create a single class session',
  })
  @ApiBody({ schema: SESSION_SWAGGERS_DATA.CREATE_SESSION_SCHEMA })
  @SwaggerResponse({ status: StatusCodes.CREATED, description: 'Session created' })
  create(
    @Body(new ZodValidationPipe<CreateSessionDto>(createSessionSchema))
    dto: CreateSessionDto,
    @CurrentUser() user: Record<string, string>,
  ) {
    return this.sessionService.createSessionService({
      userId: user?.id,
      role: user?.role,
      data: dto,
    });
  }

  // todo : bulk create class sessions for a class ...
  @Post('bulk')
  @HttpCode(StatusCodes.CREATED)
  @ApiOperation({
    summary: SESSION_SWAGGER_MESSAGES.CREATE_SESSIONS_SUCCESS,
    description: 'Create up to 50 class sessions at once',
  })
  @ApiBody({ schema: SESSION_SWAGGERS_DATA.CREATE_SESSIONS_SCHEMA })
  @SwaggerResponse({ status: StatusCodes.CREATED, description: 'Sessions created' })
  createBulk(
    @Body(new ZodValidationPipe<CreateSessionsDto>(createSessionsSchema))
    dto: CreateSessionsDto,
    @CurrentUser() user: Record<string, string>,
  ) {
    return this.sessionService.createSessionsService({
      userId: user?.id,
      role: user?.role,
      data: dto,
    });
  }

  // todo : list all sessions the current user can access (owned or enrolled classes) ...
  @Get()
  @HttpCode(StatusCodes.OK)
  @ApiOperation({
    summary: SESSION_SWAGGER_MESSAGES.GET_SESSIONS_SUCCESSFULLY,
    description: 'List sessions across the classes the current user owns or is enrolled in',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED', 'POSTPONED'],
  })
  @ApiQuery({ name: 'classId', required: false, type: String, format: 'uuid' })
  @ApiQuery({
    name: 'startDate',
    required: false,
    type: String,
    description: 'Filter sessions starting from this date (ISO)',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    type: String,
    description: 'Filter sessions ending at this date (ISO)',
  })
  @SwaggerResponse({
    status: StatusCodes.OK,
    description: SESSION_SWAGGER_MESSAGES.GET_SESSIONS_SUCCESSFULLY,
  })
  getAll(
    @CurrentUser() user: Record<string, string>,
    @Query(new ZodValidationPipe<GetSessionsQueryDto>(getSessionsSchema))
    query: GetSessionsQueryDto,
  ) {
    return this.sessionService.getSessionsService({ userId: user?.id, role: user?.role, query });
  }

  // todo : list all sessions of a class ...
  @Get('class/:classId')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({
    summary: SESSION_SWAGGER_MESSAGES.GET_SESSIONS_SUCCESSFULLY,
    description: 'List sessions of a class',
  })
  @ApiParam({ name: 'classId', type: String, format: 'uuid' })
  @SwaggerResponse({
    status: StatusCodes.OK,
    description: SESSION_SWAGGER_MESSAGES.GET_SESSIONS_SUCCESSFULLY,
  })
  getByClass(
    @CurrentUser() user: Record<string, string>,
    @Param('classId', ParseUUIDPipe) classId: string,
  ) {
    return this.sessionService.getSessionsByClassService({
      userId: user?.id,
      role: user?.role,
      classId,
    });
  }

  // todo : get session detail ...
  @Get(':id')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({
    summary: SESSION_SWAGGER_MESSAGES.GET_SESSION_SUCCESSFULLY,
    description: 'Get a session by id',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @SwaggerResponse({
    status: StatusCodes.OK,
    description: SESSION_SWAGGER_MESSAGES.GET_SESSION_SUCCESSFULLY,
  })
  getDetail(@CurrentUser() user: Record<string, string>, @Param('id', ParseUUIDPipe) id: string) {
    return this.sessionService.getSessionService({ userId: user?.id, role: user?.role, id });
  }

  // todo : update session ...
  @Put(':id')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({
    summary: SESSION_SWAGGER_MESSAGES.UPDATE_SESSION_SUCCESSFULLY,
    description: 'Update a session by id',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ schema: SESSION_SWAGGERS_DATA.UPDATE_SESSION_SCHEMA })
  @SwaggerResponse({
    status: StatusCodes.OK,
    description: SESSION_SWAGGER_MESSAGES.UPDATE_SESSION_SUCCESSFULLY,
  })
  update(
    @CurrentUser() user: Record<string, string>,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe<UpdateSessionDto>(updateSessionSchema))
    dto: UpdateSessionDto,
  ) {
    return this.sessionService.updateSessionService({
      userId: user?.id,
      role: user?.role,
      id,
      data: dto,
    });
  }

  // todo : delete session ...
  @Delete(':id')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({
    summary: SESSION_SWAGGER_MESSAGES.DEL_SESSION_SUCCESSFULLY,
    description: 'Delete a session by id',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @SwaggerResponse({
    status: StatusCodes.OK,
    description: SESSION_SWAGGER_MESSAGES.DEL_SESSION_SUCCESSFULLY,
  })
  del(@CurrentUser() user: Record<string, string>, @Param('id', ParseUUIDPipe) id: string) {
    return this.sessionService.delSessionService({ userId: user?.id, role: user?.role, id });
  }
}
