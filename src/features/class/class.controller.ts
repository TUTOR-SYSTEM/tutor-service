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
  createClassSchema,
  type GetClassesQueryDto,
  getClassesQuerySchema,
  type CreateClassDto,
  addStudentsSchema,
  type AddStudentsDto,
  updateClassSchema,
  type UpdateClassDto,
} from '@packages/entities/class';
import { ClassService } from './class.service';
import { CLASS_SWAGGER_MESSAGES } from 'src/data/swaggers/messages';
import { CLASS_SWAGGERS_DATA } from 'src/data/swaggers/data/class.swagger';
import { ParseUUIDPipe } from '@nestjs/common';

@ApiTags('Classes')
@ApiBearerAuth('access-token')
@Controller('classes')
export class ClassController {
  constructor(private readonly classService: ClassService) {}

  // todo : create new class controller ...
  @Post()
  @HttpCode(StatusCodes.CREATED)
  @ApiOperation({
    summary: 'Create class',
    description: 'Create a new class (Stage 1: class info)',
  })
  @ApiBody({ schema: CLASS_SWAGGERS_DATA.CREATE_CLASS_SCHEMA })
  @SwaggerResponse({ status: 201, description: 'Class created' })
  create(
    @Body(new ZodValidationPipe<CreateClassDto>(createClassSchema))
    dto: CreateClassDto,
    @CurrentUser() user: Record<string, string>,
  ) {
    return this.classService.createClassService({ data: dto, userId: user.id, role: user.role });
  }

  // todo : update class controller ...
  @Put(':id')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({
    summary: 'Update class',
    description: "Update a class's info and/or reconcile its enrolled students",
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @SwaggerResponse({ status: 200, description: 'Class updated' })
  update(
    @Body(new ZodValidationPipe<UpdateClassDto>(updateClassSchema))
    dto: UpdateClassDto,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: Record<string, string>,
  ) {
    return this.classService.updateClassService({
      userId: user.id,
      role: user.role,
      id,
      data: dto,
    });
  }

  // todo : generate a unique class code ...
  @Get('generate-code')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({
    summary: 'Generate class code',
    description: 'Generate a unique, unused class code',
  })
  @SwaggerResponse({ status: StatusCodes.OK, description: 'Class code generated' })
  async generateCodeController() {
    const code = await this.classService.generateNewCodeService();
    return { code };
  }

  //todo : get and filter classes controller ...
  @Get('')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({
    summary: CLASS_SWAGGER_MESSAGES.GET_CLASSES_SUCCESSFULLY,
    description: CLASS_SWAGGER_MESSAGES.GET_CLASSES_SUCCESSFULLY,
  })
  @ApiQuery(CLASS_SWAGGERS_DATA.GET_CLASSES_SCHEMA[0])
  @ApiQuery(CLASS_SWAGGERS_DATA.GET_CLASSES_SCHEMA[1])
  @ApiQuery(CLASS_SWAGGERS_DATA.GET_CLASSES_SCHEMA[2])
  @SwaggerResponse({
    status: StatusCodes.OK,
    description: CLASS_SWAGGER_MESSAGES.GET_CLASSES_SUCCESSFULLY,
  })
  async getClassesController(
    @Query(new ZodValidationPipe<GetClassesQueryDto>(getClassesQuerySchema))
    query: GetClassesQueryDto,
    @CurrentUser() user: Record<string, string>,
  ) {
    return this.classService.getClassesService({ userId: user?.id, role: user?.role, query });
  }

  // todo : get detail class controller ...
  @HttpCode(StatusCodes.OK)
  @ApiOperation({
    summary: CLASS_SWAGGER_MESSAGES.GET_CLASS_SUCCESSFULLY,
    description: CLASS_SWAGGER_MESSAGES.GET_CLASS_SUCCESSFULLY,
  })
  @ApiQuery(CLASS_SWAGGERS_DATA.GET_DETAIL_CLASS)
  @SwaggerResponse({
    status: StatusCodes.OK,
    description: CLASS_SWAGGER_MESSAGES.GET_CLASS_SUCCESSFULLY,
  })
  @Get('/:id')
  getDetailClassController(
    @CurrentUser() user: Record<string, string>,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.classService.getClassService({ userId: user?.id, role: user?.role, id });
  }

  // todo : add one student or bulk students to a class ...
  @Post(':id/students')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({
    summary: CLASS_SWAGGER_MESSAGES.ADD_STUDENTS_SUCCESSFULLY,
    description: 'Enroll one student or many students into a single class',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ schema: CLASS_SWAGGERS_DATA.ADD_STUDENTS_SCHEMA })
  @SwaggerResponse({
    status: StatusCodes.OK,
    description: CLASS_SWAGGER_MESSAGES.ADD_STUDENTS_SUCCESSFULLY,
  })
  addStudents(
    @CurrentUser() user: Record<string, string>,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe<AddStudentsDto>(addStudentsSchema))
    dto: AddStudentsDto,
  ) {
    return this.classService.addStudentsService({
      userId: user?.id,
      role: user?.role,
      classId: id,
      data: dto,
    });
  }

  // todo : get list student in class ...
  @Get('/:id/students')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({
    summary: CLASS_SWAGGER_MESSAGES.GET_STUDENTS_SUCCESSFULLY,
    description: CLASS_SWAGGER_MESSAGES.GET_STUDENTS_SUCCESSFULLY,
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @SwaggerResponse({
    status: StatusCodes.OK,
    description: CLASS_SWAGGER_MESSAGES.GET_STUDENTS_SUCCESSFULLY,
  })
  async getAllStudentController(
    @CurrentUser() user: Record<string, string>,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return await this.classService.getAllStudentsService({
      userId: user?.id,
      role: user?.role,
      id,
    });
  }

  // todo : get class materials (theory + exercise files) ...
  @Get('/:id/materials')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({
    summary: 'Get class materials',
    description: 'List theory & exercise files of a class, resolved via its curriculum lessons',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @SwaggerResponse({ status: StatusCodes.OK, description: 'Class materials retrieved' })
  async getClassMaterialsController(
    @CurrentUser() user: Record<string, string>,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.classService.getClassMaterialsService({ userId: user?.id, role: user?.role, id });
  }

  // todo : get class "watch" overview (class + recent session + schedules + students) for
  // the STUDENT/PARENT read-only page ...
  @Get('/:id/watches')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({
    summary: 'Get class watch overview',
    description:
      'Aggregated class overview (class + recent session + weekly schedule + roster) for the STUDENT/PARENT read-only page',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @SwaggerResponse({ status: StatusCodes.OK, description: 'Class watch overview retrieved' })
  getClassWatchController(
    @CurrentUser() user: Record<string, string>,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.classService.getClassWatchService({ userId: user?.id, role: user?.role, id });
  }

  // todo : delete class ...
  @Delete(':id')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({
    summary: CLASS_SWAGGER_MESSAGES.DEL_CLASS_SUCCESSFULLY,
    description: CLASS_SWAGGER_MESSAGES.DEL_CLASS_SUCCESSFULLY,
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @SwaggerResponse({
    status: StatusCodes.OK,
    description: CLASS_SWAGGER_MESSAGES.DEL_CLASS_SUCCESSFULLY,
  })
  async delClassController(
    @CurrentUser() user: Record<string, string>,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.classService.delClassService({ userId: user?.id, role: user?.role, id });
  }
}
