import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  classAddStudentsPayloadSchema,
  classCreatePayloadSchema,
  classGetAllPayloadSchema,
  classIdPayloadSchema,
  classRemoveStudentPayloadSchema,
  classUpdatePayloadSchema,
} from '@packages/entities/rpc';
import { parseRpcPayload } from '@packages/pipes';
import { ClassService } from './class.service';

/**
 * Message-pattern mirror of `ClassController` — reached only by the gateway's `TUTOR_SERVICE`
 * `ClientProxy` over RabbitMQ. Validates the payload (`rpc-payload.schema.ts`) and delegates to
 * the same, unmodified `ClassService` the HTTP controller uses; no business logic lives here.
 */
@Controller()
export class ClassRpcController {
  constructor(private readonly classService: ClassService) {}

  @MessagePattern('class.create')
  create(@Payload() payload: unknown) {
    return this.classService.createClassService(parseRpcPayload(classCreatePayloadSchema, payload));
  }

  @MessagePattern('class.update')
  update(@Payload() payload: unknown) {
    return this.classService.updateClassService(parseRpcPayload(classUpdatePayloadSchema, payload));
  }

  @MessagePattern('class.generateCode')
  async generateCode() {
    const code = await this.classService.generateNewCodeService();
    return { code };
  }

  @MessagePattern('class.getAll')
  getAll(@Payload() payload: unknown) {
    return this.classService.getClassesService(parseRpcPayload(classGetAllPayloadSchema, payload));
  }

  @MessagePattern('class.getById')
  getById(@Payload() payload: unknown) {
    return this.classService.getClassService(parseRpcPayload(classIdPayloadSchema, payload));
  }

  @MessagePattern('class.addStudents')
  addStudents(@Payload() payload: unknown) {
    return this.classService.addStudentsService(
      parseRpcPayload(classAddStudentsPayloadSchema, payload),
    );
  }

  @MessagePattern('class.removeStudent')
  removeStudent(@Payload() payload: unknown) {
    return this.classService.removeStudentService(
      parseRpcPayload(classRemoveStudentPayloadSchema, payload),
    );
  }

  @MessagePattern('class.getStudents')
  getStudents(@Payload() payload: unknown) {
    return this.classService.getAllStudentsService(parseRpcPayload(classIdPayloadSchema, payload));
  }

  @MessagePattern('class.getMaterials')
  getMaterials(@Payload() payload: unknown) {
    return this.classService.getClassMaterialsService(
      parseRpcPayload(classIdPayloadSchema, payload),
    );
  }

  @MessagePattern('class.getWatch')
  getWatch(@Payload() payload: unknown) {
    return this.classService.getClassWatchService(parseRpcPayload(classIdPayloadSchema, payload));
  }

  @MessagePattern('class.delete')
  del(@Payload() payload: unknown) {
    return this.classService.delClassService(parseRpcPayload(classIdPayloadSchema, payload));
  }
}
