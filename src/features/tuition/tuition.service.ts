import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ERROR_MESSAGES } from 'src/data/constants';
import type {
  CreateTuitionDto,
  GetTuitionsQueryDto,
  UpdateTuitionDto,
} from '@packages/entities/tuition';
import { TuitionRepository } from './tuition.repository';
import { checkUuidValid } from '@packages/helpers';

@Injectable()
export class TuitionService {
  private readonly logger = new Logger(TuitionService.name);
  constructor(private readonly repo: TuitionRepository) {}

  async create(dto: CreateTuitionDto, tutorId: string) {
    if (!tutorId || !checkUuidValid({ data: tutorId }))
      throw new BadRequestException(ERROR_MESSAGES.TUTOR_ID_INVALID);
    if (!dto.classId || !checkUuidValid({ data: dto.classId }))
      throw new BadRequestException(ERROR_MESSAGES.CLASS_ID_INVALID);
    if ((await this.repo.getClassTutorId(dto.classId)) !== tutorId) {
      throw new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND);
    }
    const result = await this.repo.create(dto);
    return result;
  }

  private assertUserId(userId: string) {
    if (!userId || !checkUuidValid({ data: userId }))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);
  }

  // scoped to the acting user: the student of a record, or the tutor of its class
  async findAll({ userId, query }: { userId: string; query: GetTuitionsQueryDto }) {
    this.assertUserId(userId);
    return this.repo.findAll({ userId, query });
  }

  async findById({ userId, id }: { userId: string; id: string }) {
    this.assertUserId(userId);
    if (!id || !checkUuidValid({ data: id }))
      throw new BadRequestException(ERROR_MESSAGES.ID_MUST_BE_UUID);
    const tuition = await this.repo.findById(id, userId);
    if (!tuition) throw new NotFoundException(ERROR_MESSAGES.TUITION_RECORD_NOT_FOUND);
    return tuition;
  }

  async update(id: string, dto: UpdateTuitionDto, tutorId: string) {
    if (!id || !checkUuidValid({ data: id }))
      throw new BadRequestException(ERROR_MESSAGES.ID_MUST_BE_UUID);
    if (!tutorId || !checkUuidValid({ data: tutorId }))
      throw new BadRequestException(ERROR_MESSAGES.TUTOR_ID_INVALID);
    const owner = await this.repo.findOwnerById(id);
    if (!owner) throw new NotFoundException(ERROR_MESSAGES.TUITION_RECORD_NOT_FOUND);
    if (owner.tutorId !== tutorId) {
      throw new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND);
    }
    const updated = await this.repo.update(id, dto);
    return updated;
  }

  async delete(id: string, tutorId: string) {
    if (!id || !checkUuidValid({ data: id }))
      throw new BadRequestException(ERROR_MESSAGES.ID_MUST_BE_UUID);
    if (!tutorId || !checkUuidValid({ data: tutorId }))
      throw new BadRequestException(ERROR_MESSAGES.TUTOR_ID_INVALID);
    const owner = await this.repo.findOwnerById(id);
    if (!owner) throw new NotFoundException(ERROR_MESSAGES.TUITION_RECORD_NOT_FOUND);
    if (owner.tutorId !== tutorId) {
      throw new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND);
    }
    await this.repo.delete(id);
    return { id };
  }

  async getSummary({ userId, classId }: { userId: string; classId?: string }) {
    this.assertUserId(userId);
    if (classId && !checkUuidValid({ data: classId }))
      throw new BadRequestException(ERROR_MESSAGES.CLASS_ID_INVALID);
    return this.repo.getSummary({ userId, classId });
  }
}
