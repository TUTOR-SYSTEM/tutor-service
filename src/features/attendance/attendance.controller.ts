import { Body, Controller, Get, HttpCode, Param, Put } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiResponse as SwaggerResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { StatusCodes } from 'http-status-codes';
import { ZodValidationPipe } from '@packages/pipes';
import { CurrentUser } from '@packages/decorators';
import { upsertAttendanceSchema, type UpsertAttendanceDto } from '@packages/entities/attendance';
import { AttendanceService } from './attendance.service';
import { ATTENDANCE_SWAGGER_MESSAGES } from 'src/data/swaggers/messages';
import { ATTENDANCE_SWAGGERS_DATA } from 'src/data/swaggers/data/attendance.swagger';
import { ParseUUIDPipe } from '@nestjs/common';

@ApiTags('Attendance')
@ApiBearerAuth('access-token')
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  // todo : list a session roster merged with each student's attendance record ...
  @Get('getBySession/:sessionId')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({
    summary: ATTENDANCE_SWAGGER_MESSAGES.GET_ATTENDANCE_SUCCESSFULLY,
    description: 'List a session roster merged with each student attendance record',
  })
  @ApiParam({ name: 'sessionId', type: String, format: 'uuid' })
  @SwaggerResponse({
    status: StatusCodes.OK,
    description: ATTENDANCE_SWAGGER_MESSAGES.GET_ATTENDANCE_SUCCESSFULLY,
  })
  getBySession(
    @CurrentUser() user: Record<string, string>,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    return this.attendanceService.getBySessionService({
      userId: user?.id,
      role: user?.role,
      sessionId,
    });
  }

  // todo : tutor marks/updates one student's attendance for a session (upsert) ...
  @Put('upsert')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({
    summary: ATTENDANCE_SWAGGER_MESSAGES.MARK_ATTENDANCE_SUCCESSFULLY,
    description: "Mark or update a single student's attendance for a session (upsert)",
  })
  @ApiBody({ schema: ATTENDANCE_SWAGGERS_DATA.UPSERT_ATTENDANCE_SCHEMA })
  @SwaggerResponse({
    status: StatusCodes.OK,
    description: ATTENDANCE_SWAGGER_MESSAGES.MARK_ATTENDANCE_SUCCESSFULLY,
  })
  upsert(
    @CurrentUser() user: Record<string, string>,
    @Body(new ZodValidationPipe<UpsertAttendanceDto>(upsertAttendanceSchema))
    dto: UpsertAttendanceDto,
  ) {
    return this.attendanceService.upsertAttendanceService({
      userId: user?.id,
      role: user?.role,
      data: dto,
    });
  }
}
