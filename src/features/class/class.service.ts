import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClassRepository } from './class.repository';
import {
  AddStudentsDto,
  CreateClassDto,
  GetClassesQueryDto,
  UpdateClassDto,
} from '@packages/entities/class';
import { checkUuidValid, generateCode } from '@packages/helpers';
import { UserService } from '../user/user.service';
import { ERROR_MESSAGES } from 'src/data/constants';

@Injectable()
export class ClassService {
  private readonly logger = new Logger(ClassService.name);
  constructor(
    private readonly repo: ClassRepository,
    private readonly user: UserService,
  ) {}

  async generateNewCodeService(): Promise<string> {
    const MAX_RETRIES = 5;
    let attempts = 0;
    let newCode = generateCode();

    while (await this.repo.getClassByField({ field: 'code', value: newCode })) {
      attempts++;
      if (attempts >= MAX_RETRIES) {
        throw new ConflictException(ERROR_MESSAGES.UNABLE_TO_GENERATE_UNIQUE_CODE);
      }
      newCode = generateCode();
    }

    return newCode;
  }

  // one query for the whole id list (was one query per id); same errors, same order
  private async assertAllStudents(ids: string[]) {
    const rows = await this.user.getUserRolesByIds(ids);
    const roleById = new Map(rows.map((r) => [r.id, r.role]));
    for (const id of ids) {
      if (!roleById.has(id))
        throw new BadRequestException(`${ERROR_MESSAGES.STUDENT_NOT_FOUND}: ${id}`);
      if (roleById.get(id) !== 'STUDENT')
        throw new BadRequestException(`${ERROR_MESSAGES.USER_NOT_A_STUDENT}: ${id}`);
    }
  }

  // postgres unique_violation (drizzle may wrap the driver error in `cause`)
  private isUniqueViolation(err: unknown): boolean {
    const e = err as { code?: string; cause?: { code?: string } };
    return e?.code === '23505' || e?.cause?.code === '23505';
  }

  async createClassService({ userId, data }: { userId: string; data: CreateClassDto }) {
    const { name, code, tutorId } = data;
    if (!userId || (userId && !checkUuidValid({ data: userId }))) {
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);
    }
    if (!(await this.user.userExists(userId)))
      throw new BadRequestException(ERROR_MESSAGES.USER_NOT_FOUND);
    if (!tutorId || !checkUuidValid({ data: tutorId })) {
      throw new BadRequestException(ERROR_MESSAGES.TUTOR_ID_MUST_BE_UUID);
    }
    const [nameExists, codeExists, tutorExists] = await Promise.all([
      this.repo.getClassByField({ field: 'name', value: name }),
      this.repo.getClassByField({ field: 'code', value: code }),
      this.user.userExists(tutorId),
    ]);
    if (nameExists) throw new BadRequestException(ERROR_MESSAGES.CLASS_NAME_EXISTS);
    if (codeExists) throw new BadRequestException(ERROR_MESSAGES.CLASS_CODE_EXISTS);
    if (!tutorExists) throw new BadRequestException(ERROR_MESSAGES.TUTOR_NOT_FOUND);

    try {
      return await this.repo.create({ data });
    } catch (err) {
      // lost a race with a concurrent create: the unique index is the source of truth
      if (this.isUniqueViolation(err)) {
        const byName = await this.repo.getClassByField({ field: 'name', value: name });
        throw new BadRequestException(
          byName ? ERROR_MESSAGES.CLASS_NAME_EXISTS : ERROR_MESSAGES.CLASS_CODE_EXISTS,
        );
      }
      throw err;
    }
  }

  async updateClassService({
    userId,
    id,
    data,
  }: {
    userId: string;
    id: string;
    data: UpdateClassDto;
  }) {
    if (!userId || !checkUuidValid({ data: userId }))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);
    if (!id || !checkUuidValid({ data: id }))
      throw new BadRequestException(ERROR_MESSAGES.CLASS_ID_MUST_BE_UUID);

    const classData = await this.repo.getClassByField({ field: 'id', value: id });
    if (!classData || classData.tutorId !== userId)
      throw new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND);

    if (data.name && data.name !== classData.name) {
      const nameExtst = await this.repo.getClassByField({ field: 'name', value: data.name });
      if (nameExtst && nameExtst.id !== id)
        throw new BadRequestException(ERROR_MESSAGES.CLASS_NAME_EXISTS);
    }

    if (data.code && data.code !== classData.code) {
      const codeExtst = await this.repo.getClassByField({ field: 'code', value: data.code });
      if (codeExtst && codeExtst.id !== id)
        throw new BadRequestException(ERROR_MESSAGES.CLASS_CODE_EXISTS);
    }

    const { studentIds, ...classFields } = data;

    if (studentIds) {
      const uniqueIds = [...new Set(studentIds)];
      await this.assertAllStudents(uniqueIds);
      await this.repo.syncStudents({ classId: id, studentIds: uniqueIds });
    }

    const updated = await this.repo.update({ id, data: classFields });
    return updated ?? classData;
  }

  async getClassesService({ userId, query }: { userId: string; query: GetClassesQueryDto }) {
    if (!userId || (userId && !checkUuidValid({ data: userId })))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);

    const acting = await this.user.getUserRoleById(userId);
    if (!acting) throw new NotFoundException(ERROR_MESSAGES.USER_NOT_EXIST);
    return await this.repo.getClasses({
      userId,
      role: acting.role ?? undefined,
      query: { ...query },
    });
  }

  // light ownership gate for child resources (schedule/session): one class row, no roster join.
  // NotFound (not Forbidden) when the class is missing or owned by someone else.
  async getOwnedClassService({ userId, id }: { userId: string; id: string }) {
    if (!id || !checkUuidValid({ data: id }))
      throw new BadRequestException(ERROR_MESSAGES.CLASS_ID_MUST_BE_UUID);
    const classData = await this.repo.getClassByField({ field: 'id', value: id });
    if (!classData || classData.tutorId !== userId)
      throw new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND);
    return classData;
  }

  //todo : get detail class service ...
  // detail read: class owner (tutor), an enrolled student, or a parent of an enrolled student —
  // same access rule as getClassWatchService. Anyone else gets NotFound (not Forbidden).
  async getClassService({ userId, id }: { userId: string; id: string }) {
    if (!userId || !checkUuidValid({ data: userId }))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);
    if (!id || !checkUuidValid({ data: id }))
      throw new BadRequestException(ERROR_MESSAGES.CLASS_ID_MUST_BE_UUID);

    const classData = await this.repo.getClass({ id });
    if (!classData) throw new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND);

    const canAccess =
      classData.tutorId === userId ||
      (await this.repo.isEnrolled({ userId, classId: id })) ||
      (await this.repo.isParentOfEnrolled({ userId, classId: id }));
    if (!canAccess) throw new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND);

    return classData;
  }

  // add one student (studentIds of length 1) or bulk students into a single class
  async addStudentsService({
    userId,
    classId,
    data,
  }: {
    userId: string;
    classId: string;
    data: AddStudentsDto;
  }) {
    if (!userId || !checkUuidValid({ data: userId }))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);
    if (!classId || !checkUuidValid({ data: classId }))
      throw new BadRequestException(ERROR_MESSAGES.CLASS_ID_MUST_BE_UUID);

    // the class must exist and be owned by the acting tutor
    const classData = await this.repo.getClassByField({ field: 'id', value: classId });
    if (!classData || classData.tutorId !== userId)
      throw new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND);

    // dedupe input, then verify every id references an existing STUDENT user
    const studentIds = [...new Set(data.studentIds)];
    await this.assertAllStudents(studentIds);

    const inserted = await this.repo.addStudents({ classId, studentIds });
    const addedIds = inserted.map((row) => row.studentId);

    return {
      classId,
      added: addedIds.length,
      skipped: studentIds.length - addedIds.length, // already enrolled
      studentIds: addedIds,
    };
  }

  async delClassService({ userId, id }: { userId: string; id: string }) {
    if (!userId || (userId && !checkUuidValid({ data: userId })))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);
    if (!id || !checkUuidValid({ data: id }))
      throw new BadRequestException(ERROR_MESSAGES.CLASS_ID_MUST_BE_UUID);

    if (!(await this.user.userExists(userId)))
      throw new NotFoundException(ERROR_MESSAGES.USER_NOT_EXIST);
    const classData = await this.repo.getClassByField({ field: 'id', value: id });
    if (!classData) throw new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND);
    if (classData.tutorId !== userId) throw new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND);

    const deleted = await this.repo.delClass({ id });
    if (!deleted) throw new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND);

    return { id };
  }

  // list a class's learning materials (theory + exercise files) resolved through its curriculum.
  // Returns lessons each carrying theoryUrls/exerciseUrls so the FE can render either list.
  async getClassMaterialsService({ userId, id }: { userId: string; id: string }) {
    if (!userId || (userId && !checkUuidValid({ data: userId })))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);
    if (!id || !checkUuidValid({ data: id }))
      throw new BadRequestException(ERROR_MESSAGES.CLASS_ID_MUST_BE_UUID);

    if (!(await this.user.userExists(userId)))
      throw new NotFoundException(ERROR_MESSAGES.USER_NOT_EXIST);
    const classData = await this.repo.getClassByField({ field: 'id', value: id });
    if (!classData) throw new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND);

    const classSummary = {
      id: classData.id,
      name: classData.name,
      subject: classData.subject,
      curriculumId: classData.curriculumId,
    };

    if (!classData.curriculumId) {
      return { class: classSummary, lessons: [], theoryCount: 0, exerciseCount: 0 };
    }

    const lessons = await this.repo.getMaterials({ curriculumId: classData.curriculumId });
    const theoryCount = lessons.reduce((n, l) => n + (l.theoryUrls?.length ?? 0), 0);
    const exerciseCount = lessons.reduce((n, l) => n + (l.exerciseUrls?.length ?? 0), 0);

    return { class: classSummary, lessons, theoryCount, exerciseCount };
  }

  // aggregated overview for the STUDENT/PARENT "watch" page: class + recent session + weekly
  // schedule + roster in one call. Access: class owner (tutor), an enrolled student, or a
  // parent of an enrolled student — same rule as SessionService.getSessionService.
  async getClassWatchService({ userId, id }: { userId: string; id: string }) {
    if (!userId || !checkUuidValid({ data: userId }))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);
    if (!id || !checkUuidValid({ data: id }))
      throw new BadRequestException(ERROR_MESSAGES.CLASS_ID_MUST_BE_UUID);

    const classData = await this.repo.getClassByField({ field: 'id', value: id });
    if (!classData) throw new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND);

    const isOwner = classData.tutorId === userId;
    const canAccess =
      isOwner ||
      (await this.repo.isEnrolled({ userId, classId: id })) ||
      (await this.repo.isParentOfEnrolled({ userId, classId: id }));
    if (!canAccess) throw new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND);

    const [students, schedules, recentSessionRow] = await Promise.all([
      this.repo.getAllStudent({ id }),
      this.repo.getSchedulesByClass({ classId: id }),
      this.repo.getRecentSessionByClass({ classId: id }),
    ]);

    // hide bài tập (exerciseUrls) from non-owners until the session has ended — mirrors
    // SessionService.gateExercises.
    const recentSession =
      recentSessionRow && !isOwner && recentSessionRow.status !== 'COMPLETED'
        ? { ...recentSessionRow, exerciseUrls: [] }
        : recentSessionRow;

    return { class: classData, recentSession: recentSession ?? null, schedules, students };
  }

  async getAllStudentsService({ userId, id }: { userId: string; id: string }) {
    if (!userId || (userId && !checkUuidValid({ data: userId })))
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);
    if (!id || !checkUuidValid({ data: id }))
      throw new BadRequestException(ERROR_MESSAGES.CLASS_ID_MUST_BE_UUID);

    if (!(await this.user.userExists(userId)))
      throw new NotFoundException(ERROR_MESSAGES.USER_NOT_EXIST);
    const classData = await this.repo.getClassByField({ field: 'id', value: id });
    if (!classData || classData.id !== id)
      throw new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND);

    const result = await this.repo.getAllStudent({ id });
    return result;
  }
}
