import { ClassRepository } from 'src/features/class/class.repository';
import { classes, classStudents, users } from 'src/database/schema';
import { createDrizzleMock, DrizzleMock, lastWhere, renderSql } from '../../support/drizzle.mock';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CLASS_ID = '22222222-2222-4222-8222-222222222222';
const CLASS_ID_2 = '33333333-3333-4333-8333-333333333333';
const STUDENT_ID = '44444444-4444-4444-8444-444444444444';
const STUDENT_ID_2 = '55555555-5555-4555-8555-555555555555';

describe('ClassRepository', () => {
  let db: DrizzleMock;
  let repo: ClassRepository;

  beforeEach(() => {
    db = createDrizzleMock();
    repo = new ClassRepository(db as never);
  });

  describe('getClassByField', () => {
    it('looks the class up by id, name or code and returns the first match', async () => {
      db.queue([{ id: CLASS_ID, code: 'M9' }]);

      await expect(repo.getClassByField({ field: 'code', value: 'M9' })).resolves.toEqual({
        id: CLASS_ID,
        code: 'M9',
      });
      const { params } = renderSql(lastWhere(db));
      expect(params).toContain('M9');
    });

    it('returns undefined when nothing matches', async () => {
      db.queue([]);

      await expect(repo.getClassByField({ field: 'name', value: 'x' })).resolves.toBeUndefined();
    });
  });

  describe('create', () => {
    it('stringifies tuition and converts date strings before inserting', async () => {
      db.queue([{ id: CLASS_ID }]);

      await repo.create({
        data: {
          name: 'Math',
          code: 'M9',
          tuition: 1200000,
          startTime: '2026-08-01T00:00:00.000Z',
          endTime: '2026-12-01T00:00:00.000Z',
          tutorId: USER_ID,
        } as never,
      });

      expect(db.insert).toHaveBeenCalledWith(classes);
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Math',
          tuition: '1200000',
          startTime: new Date('2026-08-01T00:00:00.000Z'),
          endTime: new Date('2026-12-01T00:00:00.000Z'),
        }),
      );
    });

    it('returns the inserted row', async () => {
      db.queue([{ id: CLASS_ID }]);

      await expect(repo.create({ data: { name: 'x' } as never })).resolves.toEqual({
        id: CLASS_ID,
      });
    });
  });

  describe('update', () => {
    it('only sets the fields that were provided, plus updatedAt', async () => {
      db.queue([{ id: CLASS_ID, name: 'New' }]);

      const result = await repo.update({
        id: CLASS_ID,
        data: { name: 'New', tuition: 0, location: undefined } as never,
      });

      expect(result).toEqual({ id: CLASS_ID, name: 'New' });
      const setArg = db.set.mock.calls[0][0];
      expect(setArg).toEqual({ name: 'New', tuition: '0', updatedAt: expect.any(Date) });
      expect(setArg).not.toHaveProperty('location');
    });

    it('converts startTime/endTime strings to Date', async () => {
      db.queue([{ id: CLASS_ID }]);

      await repo.update({
        id: CLASS_ID,
        data: { startTime: '2026-09-01T00:00:00.000Z' } as never,
      });

      expect(db.set.mock.calls[0][0].startTime).toEqual(new Date('2026-09-01T00:00:00.000Z'));
    });

    it('returns null when the class does not exist', async () => {
      db.queue([]);

      await expect(repo.update({ id: CLASS_ID, data: {} as never })).resolves.toBeNull();
    });
  });

  describe('syncStudents', () => {
    it('removes students not in the list, then inserts the rest ignoring duplicates', async () => {
      db.queue(undefined, undefined);

      await repo.syncStudents({ classId: CLASS_ID, studentIds: [STUDENT_ID, STUDENT_ID_2] });

      expect(db.delete).toHaveBeenCalledWith(classStudents);
      const { sql, params } = renderSql(lastWhere(db));
      expect(sql).toContain('not in');
      expect(params).toEqual(expect.arrayContaining([CLASS_ID, STUDENT_ID, STUDENT_ID_2]));
      expect(db.values).toHaveBeenCalledWith([
        { classId: CLASS_ID, studentId: STUDENT_ID },
        { classId: CLASS_ID, studentId: STUDENT_ID_2 },
      ]);
      expect(db.onConflictDoNothing).toHaveBeenCalled();
    });

    it('with an empty list only clears the class enrollment', async () => {
      db.queue(undefined);

      await repo.syncStudents({ classId: CLASS_ID, studentIds: [] });

      expect(db.delete).toHaveBeenCalledTimes(1);
      expect(db.insert).not.toHaveBeenCalled();
      const { sql } = renderSql(lastWhere(db));
      expect(sql).not.toContain('not in');
    });
  });

  describe('addStudents', () => {
    it('returns the newly inserted rows', async () => {
      db.queue([{ classId: CLASS_ID, studentId: STUDENT_ID }]);

      await expect(
        repo.addStudents({ classId: CLASS_ID, studentIds: [STUDENT_ID] }),
      ).resolves.toEqual([{ classId: CLASS_ID, studentId: STUDENT_ID }]);
      expect(db.onConflictDoNothing).toHaveBeenCalled();
    });

    it('skips the database entirely for an empty list', async () => {
      await expect(repo.addStudents({ classId: CLASS_ID, studentIds: [] })).resolves.toEqual([]);
      expect(db.insert).not.toHaveBeenCalled();
    });
  });

  describe('getClasses', () => {
    const query = { page: 1, limit: 10 } as never;

    it('scopes a tutor to the classes they own by default', async () => {
      db.queue([{ total: 0 }], []);

      await repo.getClasses({ userId: USER_ID, query });

      const { params } = renderSql(lastWhere(db));
      expect(params).toContain(USER_ID);
    });

    it('scopes a STUDENT to classes they are enrolled in', async () => {
      db.queue([{ total: 0 }], []);

      await repo.getClasses({ userId: USER_ID, role: 'STUDENT', query });

      const { sql } = renderSql(lastWhere(db));
      expect(db.select).toHaveBeenCalledWith({ classId: classStudents.classId });
      expect(sql).toContain('"classes"."id" in');
    });

    it('scopes a PARENT to classes their children are enrolled in', async () => {
      db.queue([{ total: 0 }], []);

      await repo.getClasses({ userId: USER_ID, role: 'PARENT', query });

      const { sql, params } = renderSql(lastWhere(db));
      expect(db.innerJoin).toHaveBeenCalledWith(users, expect.anything());
      expect(sql).toContain('"classes"."id" in');
    });

    it('adds a studentsId filter as an enrollment subquery', async () => {
      db.queue([{ total: 0 }], []);

      await repo.getClasses({
        userId: USER_ID,
        query: { page: 1, limit: 10, studentsId: STUDENT_ID } as never,
      });

      // the studentsId filter is a subquery over class_students
      expect(db.select).toHaveBeenCalledWith({ classId: classStudents.classId });
    });

    it('nests each class with only its own students and schedules', async () => {
      db.queue(
        [{ total: 2 }],
        [{ id: CLASS_ID }, { id: CLASS_ID_2 }],
        [
          { classId: CLASS_ID, id: STUDENT_ID, firstName: 'A' },
          { classId: CLASS_ID, id: STUDENT_ID_2, firstName: 'B' },
        ],
        [{ classId: CLASS_ID_2, id: 'sch1', dayOfWeek: 2 }],
      );

      const result = await repo.getClasses({
        userId: USER_ID,
        query: { page: 1, limit: 10 } as never,
      });

      expect(result.classes).toEqual([
        {
          id: CLASS_ID,
          students: [
            { classId: CLASS_ID, id: STUDENT_ID, firstName: 'A' },
            { classId: CLASS_ID, id: STUDENT_ID_2, firstName: 'B' },
          ],
          schedules: [],
        },
        {
          id: CLASS_ID_2,
          students: [],
          schedules: [{ classId: CLASS_ID_2, id: 'sch1', dayOfWeek: 2 }],
        },
      ]);
      expect(result.pagination).toEqual({ total: 2, page: 1, limit: 10, totalPages: 1 });
    });

    it('does not query children when the page is empty', async () => {
      db.queue([{ total: 0 }], []);

      const result = await repo.getClasses({ userId: USER_ID, query });

      expect(result.classes).toEqual([]);
      // total + page of classes only: no students/schedules queries were issued
      expect(db.select).toHaveBeenCalledTimes(2);
    });
  });

  describe('getClass', () => {
    it('returns the class with its enrolled students', async () => {
      db.queue([{ id: CLASS_ID, name: 'Math' }], [{ id: STUDENT_ID, firstName: 'A' }]);

      await expect(repo.getClass({ id: CLASS_ID })).resolves.toEqual({
        id: CLASS_ID,
        name: 'Math',
        students: [{ id: STUDENT_ID, firstName: 'A' }],
      });
    });

    it('returns null without querying students when the class is missing', async () => {
      db.queue([]);

      await expect(repo.getClass({ id: CLASS_ID })).resolves.toBeNull();
      expect(db.select).toHaveBeenCalledTimes(1);
    });
  });

  describe('delClass', () => {
    it('returns true when a class was deleted and false otherwise', async () => {
      db.queue([{ id: CLASS_ID }], []);

      await expect(repo.delClass({ id: CLASS_ID })).resolves.toBe(true);
      await expect(repo.delClass({ id: CLASS_ID })).resolves.toBe(false);
    });
  });

  describe('getMaterials', () => {
    it('returns the curriculum lessons in display order', async () => {
      const rows = [{ id: 'l1', title: 'Intro', order: 1 }];
      db.queue(rows);

      await expect(repo.getMaterials({ curriculumId: CLASS_ID })).resolves.toEqual(rows);
      expect(db.leftJoin).toHaveBeenCalled();
      expect(db.orderBy).toHaveBeenCalled();
    });
  });

  describe('isEnrolled / isParentOfEnrolled', () => {
    it('isEnrolled reflects whether an enrollment row exists', async () => {
      db.queue([{ id: 'cs' }], []);

      await expect(repo.isEnrolled({ userId: STUDENT_ID, classId: CLASS_ID })).resolves.toBe(true);
      await expect(repo.isEnrolled({ userId: STUDENT_ID, classId: CLASS_ID })).resolves.toBe(false);
    });

    it('isParentOfEnrolled reflects whether a child is enrolled', async () => {
      db.queue([{ id: 'cs' }], []);

      await expect(repo.isParentOfEnrolled({ userId: USER_ID, classId: CLASS_ID })).resolves.toBe(
        true,
      );
      await expect(repo.isParentOfEnrolled({ userId: USER_ID, classId: CLASS_ID })).resolves.toBe(
        false,
      );
    });
  });

  describe('getSchedulesByClass', () => {
    it('returns the schedules of the class', async () => {
      db.queue([{ id: 'sch1' }]);

      await expect(repo.getSchedulesByClass({ classId: CLASS_ID })).resolves.toEqual([
        { id: 'sch1' },
      ]);
    });
  });

  describe('getRecentSessionByClass', () => {
    const ongoing = { id: 'ongoing' };
    const upcoming = { id: 'upcoming' };
    const past = { id: 'past' };

    it('prefers the ongoing session', async () => {
      db.queue([ongoing]);

      await expect(repo.getRecentSessionByClass({ classId: CLASS_ID })).resolves.toBe(ongoing);
      expect(db.select).toHaveBeenCalledTimes(1);
    });

    it('falls back to the soonest upcoming session when nothing is ongoing', async () => {
      db.queue([], [upcoming]);

      await expect(repo.getRecentSessionByClass({ classId: CLASS_ID })).resolves.toBe(upcoming);
      expect(db.select).toHaveBeenCalledTimes(2);
    });

    it('falls back to the most recent past session when nothing is upcoming', async () => {
      db.queue([], [], [past]);

      await expect(repo.getRecentSessionByClass({ classId: CLASS_ID })).resolves.toBe(past);
      expect(db.select).toHaveBeenCalledTimes(3);
    });

    it('returns null when the class has no sessions at all', async () => {
      db.queue([], [], []);

      await expect(repo.getRecentSessionByClass({ classId: CLASS_ID })).resolves.toBeNull();
    });
  });

  describe('getAllStudent', () => {
    it('returns the enrolled students with their parent (left join)', async () => {
      const rows = [{ id: STUDENT_ID, parent: null }];
      db.queue(rows);

      await expect(repo.getAllStudent({ id: CLASS_ID })).resolves.toEqual(rows);
      expect(db.leftJoin).toHaveBeenCalled();
    });
  });

  describe('edge branches', () => {
    it('getClassByField searches with an empty string when the value is missing', async () => {
      db.queue([]);

      await repo.getClassByField({ field: 'name', value: undefined as never });

      expect(renderSql(lastWhere(db)).params).toContain('');
    });

    it('update sets every optional field that is provided', async () => {
      db.queue([{ id: CLASS_ID }]);
      const start = '2026-09-01T08:00:00.000Z';
      const end = '2026-09-01T09:30:00.000Z';

      await repo.update({
        id: CLASS_ID,
        data: {
          name: 'Algebra',
          code: 'ALG',
          subject: 'MATH',
          tuition: 1500000,
          description: 'desc',
          status: 'ACTIVE',
          format: 'ONLINE',
          startTime: start,
          endTime: end,
          location: 'Room 1',
          curriculumId: 'cur-1',
        } as never,
      });

      expect(db.set.mock.calls[0][0]).toEqual({
        name: 'Algebra',
        code: 'ALG',
        subject: 'MATH',
        tuition: '1500000',
        description: 'desc',
        status: 'ACTIVE',
        format: 'ONLINE',
        startTime: new Date(start),
        endTime: new Date(end),
        location: 'Room 1',
        curriculumId: 'cur-1',
        updatedAt: expect.any(Date),
      });
    });

    it('getClasses reports a zero total when the count query returns no row', async () => {
      db.queue([], []);

      const result = await repo.getClasses({
        userId: USER_ID,
        query: { page: 1, limit: 10 } as never,
      });

      expect(result.pagination.total).toBe(0);
    });
  });
});
