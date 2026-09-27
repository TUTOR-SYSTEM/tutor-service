import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import type {
  AddStudentsDto,
  CreateClassDto,
  GetClassesQueryDto,
  UpdateClassDto,
} from '@packages/entities/class';
import { ClassService } from './class.service';

/**
 * Message-pattern mirror of `ClassController` — reached only by the gateway's `TUTOR_SERVICE`
 * `ClientProxy` over RabbitMQ. Delegates to the same, unmodified
 * `ClassService` the HTTP controller uses; no business logic lives here.
 */
@Controller()
export class ClassRpcController {
  constructor(private readonly classService: ClassService) {}

  @MessagePattern('class.create')
  create(@Payload() payload: { data: CreateClassDto; userId: string }) {
    return this.classService.createClassService(payload);
  }

  @MessagePattern('class.update')
  update(@Payload() payload: { userId: string; id: string; data: UpdateClassDto }) {
    return this.classService.updateClassService(payload);
  }

  @MessagePattern('class.generateCode')
  async generateCode() {
    const code = await this.classService.generateNewCodeService();
    return { code };
  }

  @MessagePattern('class.getAll')
  getAll(@Payload() payload: { userId: string; query: GetClassesQueryDto }) {
    return this.classService.getClassesService(payload);
  }

  @MessagePattern('class.getById')
  getById(@Payload() payload: { userId: string; id: string }) {
    return this.classService.getClassService(payload);
  }

  @MessagePattern('class.addStudents')
  addStudents(@Payload() payload: { userId: string; classId: string; data: AddStudentsDto }) {
    return this.classService.addStudentsService(payload);
  }

  @MessagePattern('class.getStudents')
  getStudents(@Payload() payload: { userId: string; id: string }) {
    return this.classService.getAllStudentsService(payload);
  }

  @MessagePattern('class.getMaterials')
  getMaterials(@Payload() payload: { userId: string; id: string }) {
    return this.classService.getClassMaterialsService(payload);
  }

  @MessagePattern('class.getWatch')
  getWatch(@Payload() payload: { userId: string; id: string }) {
    return this.classService.getClassWatchService(payload);
  }

  @MessagePattern('class.delete')
  del(@Payload() payload: { userId: string; id: string }) {
    return this.classService.delClassService(payload);
  }
}