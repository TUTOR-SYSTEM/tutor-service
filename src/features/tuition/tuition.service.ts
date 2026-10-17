import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ERROR_MESSAGES } from 'src/data/constants';
import type {
  CreateTuitionDto,
  GetTuitionsQueryDto,
  UpdateTuitionDto,
} from '@packages/entities/tuition';
import { TuitionRepository } from './tuition.repository';
import { canActOnOwned, checkUuidValid } from '@packages/helpers';

@Injectable()
export class TuitionService {
  private readonly logger = new Logger(TuitionService.name);
  constructor(private readonly repo: TuitionRepository) {}

  async create(dto: CreateTuitionDto, tutorId: string, role?: string | null) {
    if (!tutorId || !checkUuidValid({ data: tutorId }))
      throw new BadRequestException(ERROR_MESSAGES.TUTOR_ID_INVALID);
    if (!dto.classId || !checkUuidValid({ data: dto.classId }))
      throw new BadRequestException(ERROR_MESSAGES.CLASS_ID_INVALID);
    const classTutorId = await this.repo.getClassTutorId(dto.classId);
    if (!classTutorId || !canActOnOwned({ userId: tutorId, role }, classTutorId)) {
      throw new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND);
    }
    // the tuition must belong to a student actually enrolled in this tutor's class; otherwise the
    // response would expose the profile (phone, avatar) of an arbitrary user
    if (!dto.studentId || !checkUuidValid({ data: dto.studentId }))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);
    if (!(await this.repo.isStudentEnrolled({ classId: dto.classId, studentId: dto.studentId })))
      throw new BadRequestException(ERROR_MESSAGES.STUDENT_NOT_IN_CLASS);
    const result = await this.repo.create(dto);
    return result;
  }

  private assertUserId(userId: string) {
    if (!userId || !checkUuidValid({ data: userId }))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);
  }

  // scoped to the acting user: the student of a record, or the tutor of its class
  async findAll({
    userId,
    role,
    query,
  }: {
    userId: string;
    role?: string | null;
    query: GetTuitionsQueryDto;
  }) {
    this.assertUserId(userId);
    return this.repo.findAll({ userId, role, query });
  }

  async findById({ userId, role, id }: { userId: string; role?: string | null; id: string }) {
    this.assertUserId(userId);
    if (!id || !checkUuidValid({ data: id }))
      throw new BadRequestException(ERROR_MESSAGES.ID_MUST_BE_UUID);
    const tuition = await this.repo.findById(id, userId, role);
    if (!tuition) throw new NotFoundException(ERROR_MESSAGES.TUITION_RECORD_NOT_FOUND);
    return tuition;
  }

  async update(id: string, dto: UpdateTuitionDto, tutorId: string, role?: string | null) {
    if (!id || !checkUuidValid({ data: id }))
      throw new BadRequestException(ERROR_MESSAGES.ID_MUST_BE_UUID);
    if (!tutorId || !checkUuidValid({ data: tutorId }))
      throw new BadRequestException(ERROR_MESSAGES.TUTOR_ID_INVALID);
    const owner = await this.repo.findOwnerById(id);
    if (!owner) throw new NotFoundException(ERROR_MESSAGES.TUITION_RECORD_NOT_FOUND);
    if (!canActOnOwned({ userId: tutorId, role }, owner.tutorId)) {
      throw new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND);
    }
    // Dashboard revenue is bucketed by `paidDate`, so marking PAID without one would make the
    // payment vanish from the reports. Stamp it now unless the caller sent a date (or null).
    // only the transition into PAID stamps the date: re-saving an already-PAID record keeps it
    const becamePaid = dto.status === 'PAID' && owner.status !== 'PAID';
    const data = becamePaid && dto.paidDate === undefined ? { ...dto, paidDate: new Date() } : dto;
    const updated = await this.repo.update(id, data);
    return updated;
  }

  async delete(id: string, tutorId: string, role?: string | null) {
    if (!id || !checkUuidValid({ data: id }))
      throw new BadRequestException(ERROR_MESSAGES.ID_MUST_BE_UUID);
    if (!tutorId || !checkUuidValid({ data: tutorId }))
      throw new BadRequestException(ERROR_MESSAGES.TUTOR_ID_INVALID);
    const owner = await this.repo.findOwnerById(id);
    if (!owner) throw new NotFoundException(ERROR_MESSAGES.TUITION_RECORD_NOT_FOUND);
    if (!canActOnOwned({ userId: tutorId, role }, owner.tutorId)) {
      throw new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND);
    }
    await this.repo.delete(id);
    return { id };
  }

  async getSummary({
    userId,
    role,
    classId,
  }: {
    userId: string;
    role?: string | null;
    classId?: string;
  }) {
    this.assertUserId(userId);
    if (classId && !checkUuidValid({ data: classId }))
      throw new BadRequestException(ERROR_MESSAGES.CLASS_ID_INVALID);
    return this.repo.getSummary({ userId, role, classId });
  }
}
