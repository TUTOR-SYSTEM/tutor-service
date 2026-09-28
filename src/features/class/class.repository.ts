import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, count, gte, inArray, lt, notInArray, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../database/database.module';
import { CreateClassDto, GetClassesQueryDto, UpdateClassDto } from '@packages/entities/class';
import {
  chapters,
  classes,
  classStudents,
  lessons,
  schedules,
  sessions,
  users,
} from '@tutor/gateway/schema';
import { buildListWhereClause } from '@packages/helpers';

@Injectable()
export class ClassRepository {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: ReturnType<typeof drizzle>,
  ) {}

  async getClassByField({ field, value }: { field: string; value: string }) {
    const fieldMaps = {
      id: classes.id,
      name: classes.name,
      code: classes.code,
    } as const;

    const [result] = await this.db
      .select()
      .from(classes)
      .where(eq(fieldMaps[field], value ?? ''));
    return result;
  }

  async create({ data }: { data: CreateClassDto }) {
    const [classData] = await this.db
      .insert(classes)
      .values({
        name: data.name,
        code: data.code,
        subject: data.subject,
        tuition: data.tuition?.toString(),
        description: data.description,
        status: data.status,
        format: data.format,
        startTime: data.startTime,
        endTime: data.endTime,
        location: data.location,
        curriculumId: data.curriculumId,
        tutorId: data.tutorId,
      })
      .returning();
    return classData;
  }

  async update({ id, data }: { id: string; data: Omit<UpdateClassDto, 'studentIds'> }) {
    const [classData] = await this.db
      .update(classes)
      .set({
        ...(data.name !== undefined && { name: data.name }),
        ...(data.code !== undefined && { code: data.code }),
        ...(data.subject !== undefined && { subject: data.subject }),
        ...(data.tuition !== undefined && { tuition: data.tuition.toString() }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.format !== undefined && { format: data.format }),
        ...(data.startTime !== undefined && { startTime: data.startTime }),
        ...(data.endTime !== undefined && { endTime: data.endTime }),
        ...(data.location !== undefined && { location: data.location }),
        ...(data.curriculumId !== undefined && { curriculumId: data.curriculumId }),
        updatedAt: new Date(),
      })
      .where(eq(classes.id, id))
      .returning();
    return classData ?? null;
  }

  // reconcile a class's enrolled students to exactly `studentIds`: remove students no longer
  // in the list, insert the ones newly added (duplicates skipped via the unique index).
  async syncStudents({ classId, studentIds }: { classId: string; studentIds: string[] }) {
    if (studentIds.length > 0) {
      await this.db
        .delete(classStudents)
        .where(
          and(eq(classStudents.classId, classId), notInArray(classStudents.studentId, studentIds)),
        );
      await this.db
        .insert(classStudents)
        .values(studentIds.map((studentId) => ({ classId, studentId })))
        .onConflictDoNothing();
    } else {
      await this.db.delete(classStudents).where(eq(classStudents.classId, classId));
    }
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
    const { page = 1, limit = 10, search, status, subject, studentsId } = query;

    const searchWhere = buildListWhereClause({
      search,
      searchableColumns: {
        name: { column: classes.name },
        code: { column: classes.code },
        subject: { column: classes.subject },
      },
      filters: { status, subject },
      filterColumns: {
        status: { column: classes.status },
        subject: { column: classes.subject },
      },
    });

    let scopeWhere: SQL | undefined;
    if (role === 'STUDENT') {
      const enrolledClassIds = this.db
        .select({ classId: classStudents.classId })
        .from(classStudents)
        .where(eq(classStudents.studentId, userId));
      scopeWhere = inArray(classes.id, enrolledClassIds);
    } else if (role === 'PARENT') {
      const childClassIds = this.db
        .select({ classId: classStudents.classId })
        .from(classStudents)
        .innerJoin(users, eq(users.id, classStudents.studentId))
        .where(eq(users.parentId, userId));
      scopeWhere = inArray(classes.id, childClassIds);
    } else {
      scopeWhere = eq(classes.tutorId, userId);
    }

    const conditions = [searchWhere, scopeWhere];
    if (studentsId) {
      const studentClassIds = this.db
        .select({ classId: classStudents.classId })
        .from(classStudents)
        .where(eq(classStudents.studentId, studentsId));
      conditions.push(inArray(classes.id, studentClassIds));
    }
    const whereClause = and(...conditions.filter((c) => c !== undefined));

    const [totalRow] = await this.db.select({ total: count() }).from(classes).where(whereClause);
    const total = Number(totalRow?.total ?? 0);
    const pageNumber = Number(page);
    const limitNumber = Number(limit);
    const offset = (pageNumber - 1) * limitNumber;

    const classesRow = await this.db
      .select()
      .from(classes)
      .where(whereClause)
      .limit(limitNumber)
      .offset(offset);

    const classIds = classesRow.map((c) => c.id);
    const [studentsRows, schedulesRows] =
      classIds.length > 0
        ? await Promise.all([
            this.db
              .select({
                classId: classStudents.classId,
                id: users.id,
                firstName: users.firstName,
                lastName: users.lastName,
                email: users.email,
                phone: users.phone,
                avatar: users.avatar,
                userCode: users.userCode,
                gender: users.gender,
                school: users.school,
                enrolledAt: classStudents.createdAt,
              })
              .from(classStudents)
              .innerJoin(users, eq(users.id, classStudents.studentId))
              .where(inArray(classStudents.classId, classIds))
              .orderBy(classStudents.createdAt),
            this.db
              .select()
              .from(schedules)
              .where(inArray(schedules.classId, classIds))
              .orderBy(asc(schedules.dayOfWeek)),
          ])
        : [[], []];

    const studentsByClass = new Map<string, (typeof studentsRows)[number][]>();
    for (const student of studentsRows) {
      const list = studentsByClass.get(student.classId) ?? [];
      list.push(student);
      studentsByClass.set(student.classId, list);
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
      pagination: {
        total,
        page: pageNumber,
        limit: limitNumber,
        totalPages: Math.ceil(total / limitNumber),
      },
    };
  }

  // enroll one or many students into a class; duplicates (already enrolled) are skipped
  // via the (class_id, student_id) unique index and simply not returned.
  async addStudents({ classId, studentIds }: { classId: string; studentIds: string[] }) {
    if (studentIds.length === 0) return [];
    const rows = await this.db
      .insert(classStudents)
      .values(studentIds.map((studentId) => ({ classId, studentId })))
      .onConflictDoNothing()
      .returning();
    return rows;
  }

  //todo : get detail class by id (with enrolled students) ...
  async getClass({ id }: { id: string }) {
    const [classData] = await this.db.select().from(classes).where(eq(classes.id, id)).limit(1);
    if (!classData) return null;

    const students = await this.db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        phone: users.phone,
        avatar: users.avatar,
        userCode: users.userCode,
        gender: users.gender,
        school: users.school,
        enrolledAt: classStudents.createdAt,
      })
      .from(classStudents)
      .innerJoin(users, eq(users.id, classStudents.studentId))
      .where(eq(classStudents.classId, id))
      .orderBy(classStudents.createdAt);

    return { ...classData, students };
  }

  async delClass({ id }: { id: string }) {
    const [classData] = await this.db.delete(classes).where(eq(classes.id, id)).returning();
    return !!classData;
  }

  // list every lesson of a curriculum, joined with its chapter title, ordered for display.
  // Each lesson carries its theoryUrls / exerciseUrls — the service derives the two material lists.
  async getMaterials({ curriculumId }: { curriculumId: string }) {
    return await this.db
      .select({
        id: lessons.id,
        title: lessons.title,
        description: lessons.description,
        order: lessons.order,
        chapterId: lessons.chapterId,
        chapterTitle: chapters.title,
        theoryUrls: lessons.theoryUrls,
        exerciseUrls: lessons.exerciseUrls,
        createdAt: lessons.createdAt,
      })
      .from(lessons)
      .leftJoin(chapters, eq(chapters.id, lessons.chapterId))
      .where(eq(lessons.curriculumId, curriculumId))
      .orderBy(asc(lessons.order), asc(lessons.createdAt));
  }

  async isEnrolled({ userId, classId }: { userId: string; classId: string }) {
    const [row] = await this.db
      .select({ id: classStudents.id })
      .from(classStudents)
      .where(and(eq(classStudents.classId, classId), eq(classStudents.studentId, userId)))
      .limit(1);
    return !!row;
  }

  // a parent can reach a class when one of their children (users.parentId = userId) is enrolled
  async isParentOfEnrolled({ userId, classId }: { userId: string; classId: string }) {
    const [row] = await this.db
      .select({ id: classStudents.id })
      .from(classStudents)
      .innerJoin(users, eq(users.id, classStudents.studentId))
      .where(and(eq(classStudents.classId, classId), eq(users.parentId, userId)))
      .limit(1);
    return !!row;
  }

  async getSchedulesByClass({ classId }: { classId: string }) {
    return this.db
      .select()
      .from(schedules)
      .where(eq(schedules.classId, classId))
      .orderBy(asc(schedules.dayOfWeek));
  }

  // the session to surface on the "watch" overview: the one currently ongoing, else the
  // soonest upcoming one, else (nothing left to look forward to) the most recently past one.
  async getRecentSessionByClass({ classId }: { classId: string }) {
    const now = new Date();

    const [ongoing] = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.classId, classId), eq(sessions.status, 'ONGOING')))
      .orderBy(asc(sessions.startAt))
      .limit(1);
    if (ongoing) return ongoing;

    const [upcoming] = await this.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.classId, classId),
          gte(sessions.startAt, now),
          inArray(sessions.status, ['SCHEDULED', 'POSTPONED']),
        ),
      )
      .orderBy(asc(sessions.startAt))
      .limit(1);
    if (upcoming) return upcoming;

    const [past] = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.classId, classId), lt(sessions.startAt, now)))
      .orderBy(desc(sessions.startAt))
      .limit(1);
    return past ?? null;
  }

  async getAllStudent({ id }: { id: string }) {
    const parents = alias(users, 'parents');
    return await this.db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        avatar: users.avatar,
        phone: users.phone,
        role: users.role,
        userCode: users.userCode,
        parent: {
          id: parents.id,
          firstName: parents.firstName,
          lastName: parents.lastName,
          email: parents.email,
          avatar: parents.avatar,
          phone: parents.phone,
          relationship: parents.relationship,
        },
      })
      .from(classStudents)
      .innerJoin(users, eq(users.id, classStudents.studentId))
      .leftJoin(parents, eq(parents.id, users.parentId))
      .where(eq(classStudents.classId, id));
  }
}
