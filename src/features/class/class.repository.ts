import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, isRecordNotFound } from '../../database/prisma.service';
import { CreateClassDto, GetClassesQueryDto, UpdateClassDto } from '@packages/entities/class';
import { buildListWhereClause, buildPagination } from '@packages/helpers';
import { toDate } from '@packages/helpers/date.helper';

const ENROLLED_STUDENT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  avatar: true,
  userCode: true,
  gender: true,
  school: true,
} satisfies Prisma.UserSelect;

type EnrollmentWithStudent = Prisma.ClassStudentGetPayload<{
  select: { createdAt: true; student: { select: typeof ENROLLED_STUDENT_SELECT } };
}> & { classId?: string };

const flattenEnrollment = ({ student, createdAt, ...rest }: EnrollmentWithStudent) => ({
  ...rest,
  ...student,
  enrolledAt: createdAt,
});

@Injectable()
export class ClassRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getClassByField({ field, value }: { field: string; value: string }) {
    const fields = ['id', 'name', 'code'];
    if (!fields.includes(field)) return null;
    return this.prisma.class.findFirst({ where: { [field]: value ?? '' } });
  }

  async create({ data }: { data: CreateClassDto }) {
    return this.prisma.class.create({
      data: {
        name: data.name,
        code: data.code,
        subject: data.subject,
        tuition: data.tuition?.toString(),
        description: data.description,
        status: data.status,
        format: data.format,
        startTime: toDate(data.startTime),
        endTime: toDate(data.endTime),
        location: data.location,
        curriculumId: data.curriculumId,
        tutorId: data.tutorId,
        maxStudents: data.maxStudents ?? 10,
      },
    });
  }

  /** Các trường cập nhật được. `undefined` = giữ nguyên; `null` = xoá giá trị (field nullable). */
  private buildUpdateData(data: Omit<UpdateClassDto, 'studentIds'>) {
    return {
      name: data.name,
      code: data.code,
      subject: data.subject,
      tuition: data.tuition?.toString(),
      description: data.description,
      status: data.status,
      format: data.format,
      startTime: toDate(data.startTime),
      endTime: toDate(data.endTime),
      location: data.location,
      curriculumId: data.curriculumId,
      tutorId: data.tutorId,
      maxStudents: data.maxStudents,
    };
  }

  async update({ id, data }: { id: string; data: Omit<UpdateClassDto, 'studentIds'> }) {
    try {
      return await this.prisma.class.update({ where: { id }, data: this.buildUpdateData(data) });
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  /**
   * Cập nhật lớp và (nếu có `studentIds`) đồng bộ roster trong CÙNG một transaction:
   * lỗi ở bước nào cũng rollback cả hai. `studentIds` là danh sách đầy đủ sau cập nhật;
   * `[]` xoá toàn bộ học sinh (`notIn: []` khớp mọi dòng).
   */
  async updateWithRoster({
    id,
    data,
    studentIds,
  }: {
    id: string;
    data: Omit<UpdateClassDto, 'studentIds'>;
    studentIds?: string[];
  }) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.class.update({ where: { id }, data: this.buildUpdateData(data) });
        if (studentIds) {
          await tx.classStudent.deleteMany({
            where: { classId: id, studentId: { notIn: studentIds } },
          });
          await tx.classStudent.createMany({
            data: studentIds.map((studentId) => ({ classId: id, studentId })),
            skipDuplicates: true,
          });
        }
        // Gia sư học sinh luôn theo gia sư lớp: đồng bộ khi đổi gia sư lớp hoặc roster.
        if (studentIds || data.tutorId !== undefined) {
          const roster = studentIds
            ? studentIds
            : (
                await tx.classStudent.findMany({ where: { classId: id }, select: { studentId: true } })
              ).map((row) => row.studentId);
          await this.syncStudentsTutor(tx, roster, updated.tutorId);
        }
        return updated;
      });
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  /**
   * Quy tắc: gia sư quản lý học sinh = gia sư của lớp học sinh tham gia.
   * Trả về id học sinh (trong `studentIds`) đang thuộc một lớp khác có gia sư ≠ `tutorId`.
   */
  async findStudentIdsWithOtherTutor({
    studentIds,
    tutorId,
    excludeClassId,
  }: {
    studentIds: string[];
    tutorId: string;
    excludeClassId?: string;
  }): Promise<string[]> {
    if (studentIds.length === 0) return [];
    const rows = await this.prisma.classStudent.findMany({
      where: {
        studentId: { in: studentIds },
        ...(excludeClassId ? { classId: { not: excludeClassId } } : {}),
        class: { tutorId: { not: tutorId } },
      },
      select: { studentId: true },
      distinct: ['studentId'],
    });
    return rows.map((row) => row.studentId);
  }

  /** Gán gia sư quản lý cho các học sinh (chỉ role STUDENT). */
  private async syncStudentsTutor(
    tx: Prisma.TransactionClient,
    studentIds: string[],
    tutorId: string,
  ) {
    if (studentIds.length === 0) return;
    await tx.user.updateMany({
      where: { id: { in: studentIds }, role: 'STUDENT' },
      data: { tutorId },
    });
  }

  /** Id học sinh đang thuộc lớp (không kèm thông tin cá nhân). */
  async getRosterStudentIds({ classId }: { classId: string }) {
    const rows = await this.prisma.classStudent.findMany({
      where: { classId },
      select: { studentId: true },
    });
    return rows.map((row) => row.studentId);
  }

  async getClasses({
    userId,
    role,
    query,
  }: {
    userId: string;
    role?: string;
    query: GetClassesQueryDto;
  }) {
    const { page = 1, limit = 10, search, status, subject, studentsId, tutorId } = query;

    const searchWhere = buildListWhereClause({
      search,
      searchFields: ['name', 'code', 'subject'],
      filters: { status, subject },
    });

    let scopeWhere: Prisma.ClassWhereInput;
    if (role === 'STUDENT') {
      scopeWhere = { students: { some: { studentId: userId } } };
    } else if (role === 'PARENT') {
      scopeWhere = { students: { some: { student: { parentId: userId } } } };
    } else if (role === 'ADMIN') {
      // ADMIN: mọi lớp, hoặc chỉ lớp của gia sư được chọn.
      scopeWhere = tutorId ? { tutorId } : {};
    } else {
      scopeWhere = { tutorId: userId };
    }

    const conditions: Prisma.ClassWhereInput[] = [scopeWhere];
    if (searchWhere) conditions.push(searchWhere);
    if (studentsId) conditions.push({ students: { some: { studentId: studentsId } } });
    const where: Prisma.ClassWhereInput = { AND: conditions };

    const pageNumber = Number(page);
    const limitNumber = Number(limit);

    const [total, classesRow] = await Promise.all([
      this.prisma.class.count({ where }),
      this.prisma.class.findMany({
        where,
        take: limitNumber,
        skip: (pageNumber - 1) * limitNumber,
      }),
    ]);

    const classIds = classesRow.map((c) => c.id);
    const [studentsRows, schedulesRows] =
      classIds.length > 0
        ? await Promise.all([
            this.prisma.classStudent.findMany({
              where: { classId: { in: classIds } },
              select: {
                classId: true,
                createdAt: true,
                student: { select: ENROLLED_STUDENT_SELECT },
              },
              orderBy: { createdAt: 'asc' },
            }),
            this.prisma.schedule.findMany({
              where: { classId: { in: classIds } },
              orderBy: { dayOfWeek: 'asc' },
            }),
          ])
        : [[], []];

    const studentsByClass = new Map<string, ReturnType<typeof flattenEnrollment>[]>();
    for (const row of studentsRows) {
      const list = studentsByClass.get(row.classId) ?? [];
      list.push(flattenEnrollment(row));
      studentsByClass.set(row.classId, list);
    }

    const schedulesByClass = new Map<string, (typeof schedulesRows)[number][]>();
    for (const schedule of schedulesRows) {
      const list = schedulesByClass.get(schedule.classId) ?? [];
      list.push(schedule);
      schedulesByClass.set(schedule.classId, list);
    }

    return {
      classes: classesRow.map((classData) => ({
        ...classData,
        students: studentsByClass.get(classData.id) ?? [],
        schedules: schedulesByClass.get(classData.id) ?? [],
      })),
      pagination: buildPagination(total, pageNumber, limitNumber),
    };
  }

  // enroll one or many students into a class; duplicates (already enrolled) are skipped
  // via the (class_id, student_id) unique index and simply not returned.
  /** Thêm học sinh vào lớp và gán gia sư lớp cho họ, trong cùng một transaction. */
  /** Removes one student from a class; returns how many enrollment rows were deleted (0 or 1). */
  async removeStudent({ classId, studentId }: { classId: string; studentId: string }) {
    const { count } = await this.prisma.classStudent.deleteMany({
      where: { classId, studentId },
    });
    return count;
  }

  async addStudents({
    classId,
    studentIds,
    tutorId,
  }: {
    classId: string;
    studentIds: string[];
    tutorId: string;
  }) {
    if (studentIds.length === 0) return [];
    return this.prisma.$transaction(async (tx) => {
      const inserted = await tx.classStudent.createManyAndReturn({
        data: studentIds.map((studentId) => ({ classId, studentId })),
        skipDuplicates: true,
      });
      await this.syncStudentsTutor(tx, studentIds, tutorId);
      return inserted;
    });
  }

  //todo : get detail class by id (with enrolled students) ...
  async getClass({ id }: { id: string }) {
    const classData = await this.prisma.class.findUnique({ where: { id } });
    if (!classData) return null;

    const enrollments = await this.prisma.classStudent.findMany({
      where: { classId: id },
      select: { createdAt: true, student: { select: ENROLLED_STUDENT_SELECT } },
      orderBy: { createdAt: 'asc' },
    });

    return { ...classData, students: enrollments.map(flattenEnrollment) };
  }

  /** True when any tuition record (any status) still references the class. */
  async hasTuitionHistory({ classId }: { classId: string }) {
    const row = await this.prisma.tuition.findFirst({ where: { classId }, select: { id: true } });
    return !!row;
  }

  async delClass({ id }: { id: string }) {
    const { count } = await this.prisma.class.deleteMany({ where: { id } });
    return count > 0;
  }

  // list every lesson of a curriculum, joined with its chapter title, ordered for display.
  // Each lesson carries its theoryUrls / exerciseUrls — the service derives the two material lists.
  async getMaterials({ curriculumId }: { curriculumId: string }) {
    const lessons = await this.prisma.lesson.findMany({
      where: { curriculumId },
      select: {
        id: true,
        title: true,
        description: true,
        order: true,
        chapterId: true,
        chapter: { select: { title: true } },
        theoryUrls: true,
        exerciseUrls: true,
        createdAt: true,
      },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return lessons.map(({ chapter, theoryUrls, exerciseUrls, ...lesson }) => ({
      ...lesson,
      theoryUrls: theoryUrls as Prisma.JsonArray | null,
      exerciseUrls: exerciseUrls as Prisma.JsonArray | null,
      chapterTitle: chapter?.title ?? null,
    }));
  }

  async isEnrolled({ userId, classId }: { userId: string; classId: string }) {
    const row = await this.prisma.classStudent.findFirst({
      where: { classId, studentId: userId },
      select: { id: true },
    });
    return !!row;
  }

  // a parent can reach a class when one of their children (users.parentId = userId) is enrolled
  async isParentOfEnrolled({ userId, classId }: { userId: string; classId: string }) {
    const row = await this.prisma.classStudent.findFirst({
      where: { classId, student: { parentId: userId } },
      select: { id: true },
    });
    return !!row;
  }

  async getSchedulesByClass({ classId }: { classId: string }) {
    return this.prisma.schedule.findMany({ where: { classId }, orderBy: { dayOfWeek: 'asc' } });
  }

  // the session to surface on the "watch" overview: the one currently ongoing, else the
  // soonest upcoming one, else (nothing left to look forward to) the most recently past one.
  async getRecentSessionByClass({ classId }: { classId: string }) {
    const now = new Date();

    const ongoing = await this.prisma.classSession.findFirst({
      where: { classId, status: 'ONGOING' },
      orderBy: { startAt: 'asc' },
    });
    if (ongoing) return ongoing;

    const upcoming = await this.prisma.classSession.findFirst({
      where: { classId, startAt: { gte: now }, status: { in: ['SCHEDULED', 'POSTPONED'] } },
      orderBy: { startAt: 'asc' },
    });
    if (upcoming) return upcoming;

    return this.prisma.classSession.findFirst({
      where: { classId, startAt: { lt: now } },
      orderBy: { startAt: 'desc' },
    });
  }

  async getAllStudent({ id }: { id: string }) {
    const rows = await this.prisma.classStudent.findMany({
      where: { classId: id },
      select: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            avatar: true,
            phone: true,
            role: true,
            userCode: true,
            parent: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                avatar: true,
                phone: true,
                relationship: true,
              },
            },
          },
        },
      },
    });
    return rows.map((row) => row.student);
  }
}
