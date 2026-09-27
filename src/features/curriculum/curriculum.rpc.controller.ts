import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import type {
  CreateCurriculumDto,
  GetCurriculumsQueryDto,
} from '@packages/entities/curriculum';
import { CurriculumService } from './curriculum.service';

/**
 * Message-pattern mirror of `CurriculumController` — reached only by the gateway's `TUTOR_SERVICE`
 * `ClientProxy` over RabbitMQ. Delegates to the same, unmodified
 * `CurriculumService` the HTTP controller uses; no business logic lives here.
 */
@Controller()
export class CurriculumRpcController {
  constructor(private readonly curriculumService: CurriculumService) {}

  @MessagePattern('curriculum.generateCode')
  async generateCode() {
    const code = await this.curriculumService.generateNewCodeService();
    return { code };
  }

  @MessagePattern('curriculum.create')
  create(@Payload() payload: { userId: string; createCurriculum: CreateCurriculumDto }) {
    return this.curriculumService.createCurriculumService(payload);
  }

  @MessagePattern('curriculum.getAll')
  getAll(@Payload() payload: { userId: string; query: GetCurriculumsQueryDto }) {
    return this.curriculumService.getAllCurriculumService(payload);
  }

  @MessagePattern('curriculum.getById')
  getById(@Payload() payload: { userId: string; id: string }) {
    return this.curriculumService.getCurriculumByIdService(payload);
  }

  @MessagePattern('curriculum.update')
  update(@Payload() payload: { userId: string; id: string; data: CreateCurriculumDto }) {
    return this.curriculumService.updateCurriculumService(payload);
  }

  @MessagePattern('curriculum.delete')
  del(@Payload() payload: { userId: string; id: string }) {
    return this.curriculumService.deleteCurriculumService(payload);
  }
}