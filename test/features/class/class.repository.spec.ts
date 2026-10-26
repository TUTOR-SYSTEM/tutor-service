import { Prisma } from '@prisma/client';
import { ClassRepository } from 'src/features/class/class.repository';
import { createPrismaMock, PrismaMock } from '../../support/prisma.mock';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CLASS_ID = '22222222-2222-4222-8222-222222222222';
const CLASS_ID_2 = '33333333-3333-4333-8333-333333333333';
const STUDENT_ID = '44444444-4444-4444-8444-444444444444';
const STUDENT_ID_2 = '55555555-5555-4555-8555-555555555555';

const notFound = () =>
  new Prisma.PrismaClientKnownRequestError('not found', { code: 'P2025', clientVersion: 'test' });

const enrollment = (classId: string, id: string, firstName: string) => ({
  classId,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  student: { id, firstName },
});

describe('ClassRepository', () => {
  let prisma: PrismaMock;
  let repo: ClassRepository;

  beforeEach(() => {
    prisma = createPrismaMock();
    repo = new ClassRepository(prisma as never);
  });

  describe('getClassByField', () => {
    it('looks the class up by id, name or code and returns the first match', async () => {
      prisma.class.findFirst.mockResolvedValue({ id: CLASS_ID, code: 'M9' });

      await expect(repo.getClassByField({ field: 'code', value: 'M9' })).resolves.toEqual({
        id: CLASS_ID,
        code: 'M9',
      });
      expect(prisma.class.findFirst).toHaveBeenCalledWith({ where: { code: 'M9' } });
    });

    it('returns null when nothing matches', async () => {
      prisma.class.findFirst.mockResolvedValue(null);

      await expect(repo.getClassByField({ field: 'name', value: 'x' })).resolves.toBeNull();
    });

    it('refuses fields outside the id/name/code whitelist without querying', async () => {
      await expect(repo.getClassByField({ field: 'tutorId', value: 'x' })).resolves.toBeNull();
      expect(prisma.class.findFirst).not.toHaveBeenCalled();
    });

    it('searches with an empty string when the value is missing', async () => {
      prisma.class.findFirst.mockResolvedValue(null);

      await repo.getClassByField({ field: 'name', value: undefined as never });

      expect(prisma.class.findFirst).toHaveBeenCalledWith({ where: { name: '' } });
    });
  });

  describe('create', () => {
    it('stringifies tuition and converts date strings before inserting', async () => {
      prisma.class.create.mockResolvedValue({ id: CLASS_ID });

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

      expect(prisma.class.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Math',
          tuition: '1200000',
          startTime: new Date('2026-08-01T00:00:00.000Z'),
          endTime: new Date('2026-12-01T00:00:00.000Z'),
        }),
      });
    });

    it('returns the inserted row', async () => {
      prisma.class.create.mockResolvedValue({ id: CLASS_ID });

      await expect(repo.create({ data: { name: 'x' } as never })).resolves.toEqual({
        id: CLASS_ID,
      });
    });
  });

  describe('update', () => {
    it('only writes the fields that were provided', async () => {
      prisma.class.update.mockResolvedValue({ id: CLASS_ID, name: 'New' });

      const result = await repo.update({
        id: CLASS_ID,
        data: { name: 'New', tuition: 0, location: undefined } as never,
      });

      expect(result).toEqual({ id: CLASS_ID, name: 'New' });
      const { where, data } = prisma.class.update.mock.calls[0][0];
      expect(where).toEqual({ id: CLASS_ID });
      expect(data.name).toBe('New');
      expect(data.tuition).toBe('0');
      expect(data.location).toBeUndefined(); // Prisma skips undefined → column untouched
    });

    it('converts startTime/endTime strings to Date', async () => {
      prisma.class.update.mockResolvedValue({ id: CLASS_ID });

      await repo.update({
        id: CLASS_ID,
        data: { startTime: '2026-09-01T00:00:00.000Z' } as never,
      });

      expect(prisma.class.update.mock.calls[0][0].data.startTime).toEqual(
        new Date('2026-09-01T00:00:00.000Z'),
      );
    });

    it('writes every optional field that is provided', async () => {
      prisma.class.update.mockResolvedValue({ id: CLASS_ID });
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
          status: 'OPEN',
          format: 'ONLINE',
          startTime: start,
          endTime: end,
          location: 'Room 1',
          curriculumId: 'cur-1',
        } as never,
      });

      expect(prisma.class.update).toHaveBeenCalledWith({
        where: { id: CLASS_ID },
        data: {
          name: 'Algebra',
          code: 'ALG',
          subject: 'MATH',
          tuition: '1500000',
          description: 'desc',
          status: 'OPEN',
          format: 'ONLINE',
          startTime: new Date(start),
          endTime: new Date(end),
          location: 'Room 1',
          curriculumId: 'cur-1',
        },
      });
    });

    it('returns null when the class does not exist', async () => {
      prisma.class.update.mockRejectedValue(notFound());

      await expect(repo.update({ id: CLASS_ID, data: {} as never })).resolves.toBeNull();
    });
  });

  describe('syncStudents', () => {
    it('removes students not in the list, then inserts the rest ignoring duplicates', async () => {
      await repo.syncStudents({ classId: CLASS_ID, studentIds: [STUDENT_ID, STUDENT_ID_2] });

      expect(prisma.classStudent.deleteMany).toHaveBeenCalledWith({
        where: { classId: CLASS_ID, studentId: { notIn: [STUDENT_ID, STUDENT_ID_2] } },
      });
      expect(prisma.classStudent.createMany).toHaveBeenCalledWith({
        data: [
          { classId: CLASS_ID, studentId: STUDENT_ID },
          { classId: CLASS_ID, studentId: STUDENT_ID_2 },
        ],
        skipDuplicates: true,
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('with an empty list clears the whole class enrollment', async () => {
      await repo.syncStudents({ classId: CLASS_ID, studentIds: [] });

      // `notIn: []` matches every row, so every enrollment of the class is removed
      expect(prisma.classStudent.deleteMany).toHaveBeenCalledWith({
        where: { classId: CLASS_ID, studentId: { notIn: [] } },
      });
      expect(prisma.classStudent.createMany).toHaveBeenCalledWith({
        data: [],
        skipDuplicates: true,
      });
    });
  });

  describe('addStudents', () => {
    it('returns the newly inserted rows', async () => {
      prisma.classStudent.createManyAndReturn.mockResolvedValue([
        { classId: CLASS_ID, studentId: STUDENT_ID },
      ]);

      await expect(
        repo.addStudents({ classId: CLASS_ID, studentIds: [STUDENT_ID] }),
      ).resolves.toEqual([{ classId: CLASS_ID, studentId: STUDENT_ID }]);
      expect(prisma.classStudent.createManyAndReturn).toHaveBeenCalledWith({
        data: [{ classId: CLASS_ID, studentId: STUDENT_ID }],
        skipDuplicates: true,
      });
    });

    it('skips the database entirely for an empty list', async () => {
      await expect(repo.addStudents({ classId: CLASS_ID, studentIds: [] })).resolves.toEqual([]);
      expect(prisma.classStudent.createManyAndReturn).not.toHaveBeenCalled();
    });
  });

  describe('getClasses', () => {
    const query = { page: 1, limit: 10 } as never;

    beforeEach(() => {
      prisma.class.count.mockResolvedValue(0);
      prisma.class.findMany.mockResolvedValue([]);
    });

    it('scopes a tutor to the classes they own by default', async () => {
      await repo.getClasses({ userId: USER_ID, query });

      expect(prisma.class.count).toHaveBeenCalledWith({
        where: { AND: [{ tutorId: USER_ID }] },
      });
    });

    it('scopes a STUDENT to classes they are enrolled in', async () => {
      await repo.getClasses({ userId: USER_ID, role: 'STUDENT', query });

      expect(prisma.class.count).toHaveBeenCalledWith({
        where: { AND: [{ students: { some: { studentId: USER_ID } } }] },
      });
    });

    it('scopes a PARENT to classes their children are enrolled in', async () => {
      await repo.getClasses({ userId: USER_ID, role: 'PARENT', query });

      expect(prisma.class.count).toHaveBeenCalledWith({
        where: { AND: [{ students: { some: { student: { parentId: USER_ID } } } }] },
      });
    });

    it('applies search and exact filters next to the scope', async () => {
      await repo.getClasses({
        userId: USER_ID,
        query: { page: 1, limit: 10, search: 'alg', status: 'OPEN', subject: 'MATH' } as never,
      });

      expect(prisma.class.count).toHaveBeenCalledWith({
        where: {
          AND: [
            { tutorId: USER_ID },
            {
              AND: [
                {
                  OR: [
                    { name: { contains: 'alg', mode: 'insensitive' } },
                    { code: { contains: 'alg', mode: 'insensitive' } },
                    { subject: { contains: 'alg', mode: 'insensitive' } },
                  ],
                },
                { status: 'OPEN' },
                { subject: 'MATH' },
              ],
            },
          ],
        },
      });
    });

    it('adds a studentsId filter as an enrollment condition', async () => {
      await repo.getClasses({
        userId: USER_ID,
        query: { page: 1, limit: 10, studentsId: STUDENT_ID } as never,
      });

      expect(prisma.class.count).toHaveBeenCalledWith({
        where: {
          AND: [{ tutorId: USER_ID }, { students: { some: { studentId: STUDENT_ID } } }],
        },
      });
    });

    it('paginates with take/skip', async () => {
      prisma.class.count.mockResolvedValue(25);

      const result = await repo.getClasses({
        userId: USER_ID,
        query: { page: '3', limit: '10' } as never,
      });

      expect(prisma.class.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10, skip: 20 }),
      );
      expect(result.pagination).toEqual({ total: 25, page: 3, limit: 10, totalPages: 3 });
    });

    it('nests each class with only its own students and schedules', async () => {
      prisma.class.count.mockResolvedValue(2);
      prisma.class.findMany.mockResolvedValue([{ id: CLASS_ID }, { id: CLASS_ID_2 }]);
      prisma.classStudent.findMany.mockResolvedValue([
        enrollment(CLASS_ID, STUDENT_ID, 'A'),
        enrollment(CLASS_ID, STUDENT_ID_2, 'B'),
      ]);
      prisma.schedule.findMany.mockResolvedValue([
        { classId: CLASS_ID_2, id: 'sch1', dayOfWeek: 'TUESDAY' },
      ]);

      const result = await repo.getClasses({ userId: USER_ID, query });

      expect(result.classes).toEqual([
        {
          id: CLASS_ID,
          students: [
            expect.objectContaining({ id: STUDENT_ID, firstName: 'A', classId: CLASS_ID }),
            expect.objectContaining({ id: STUDENT_ID_2, firstName: 'B', classId: CLASS_ID }),
          ],
          schedules: [],
        },
        {
          id: CLASS_ID_2,
          students: [],
          schedules: [{ classId: CLASS_ID_2, id: 'sch1', dayOfWeek: 'TUESDAY' }],
        },
      ]);
      expect(result.classes[0].students[0]).toHaveProperty('enrolledAt');
      expect(prisma.classStudent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { classId: { in: [CLASS_ID, CLASS_ID_2] } } }),
      );
    });

    it('does not query children when the page is empty', async () => {
      const result = await repo.getClasses({ userId: USER_ID, query });

      expect(result.classes).toEqual([]);
      expect(prisma.classStudent.findMany).not.toHaveBeenCalled();
      expect(prisma.schedule.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getClass', () => {
    it('returns the class with its enrolled students', async () => {
      prisma.class.findUnique.mockResolvedValue({ id: CLASS_ID, name: 'Math' });
      prisma.classStudent.findMany.mockResolvedValue([
        { createdAt: new Date('2026-01-01T00:00:00Z'), student: { id: STUDENT_ID } },
      ]);

      await expect(repo.getClass({ id: CLASS_ID })).resolves.toEqual({
        id: CLASS_ID,
        name: 'Math',
        students: [{ id: STUDENT_ID, enrolledAt: new Date('2026-01-01T00:00:00Z') }],
      });
    });

    it('returns null without querying students when the class is missing', async () => {
      prisma.class.findUnique.mockResolvedValue(null);

      await expect(repo.getClass({ id: CLASS_ID })).resolves.toBeNull();
      expect(prisma.classStudent.findMany).not.toHaveBeenCalled();
    });
  });

  describe('hasTuitionHistory', () => {
    it('is true when any tuition references the class', async () => {
      prisma.tuition.findFirst.mockResolvedValue({ id: 't1' });

      await expect(repo.hasTuitionHistory({ classId: CLASS_ID })).resolves.toBe(true);
    });

    it('is false when none does', async () => {
      prisma.tuition.findFirst.mockResolvedValue(null);

      await expect(repo.hasTuitionHistory({ classId: CLASS_ID })).resolves.toBe(false);
    });
  });

  describe('delClass', () => {
    it('returns true when a class was deleted and false otherwise', async () => {
      prisma.class.deleteMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      await expect(repo.delClass({ id: CLASS_ID })).resolves.toBe(true);
      await expect(repo.delClass({ id: CLASS_ID })).resolves.toBe(false);
    });
  });

  describe('getMaterials', () => {
    it('returns the curriculum lessons with their chapter title, in display order', async () => {
      prisma.lesson.findMany.mockResolvedValue([
        {
          id: 'l1',
          title: 'Intro',
          order: 1,
          chapter: { title: 'Ch 1' },
          theoryUrls: [],
          exerciseUrls: [],
        },
        { id: 'l2', title: 'Loose', order: 2, chapter: null, theoryUrls: null, exerciseUrls: null },
      ]);

      const result = await repo.getMaterials({ curriculumId: CLASS_ID });

      expect(result).toEqual([
        expect.objectContaining({ id: 'l1', chapterTitle: 'Ch 1' }),
        expect.objectContaining({ id: 'l2', chapterTitle: null }),
      ]);
      expect(result[0]).not.toHaveProperty('chapter');
      expect(prisma.lesson.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { curriculumId: CLASS_ID },
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        }),
      );
    });
  });

  describe('isEnrolled / isParentOfEnrolled', () => {
    it('isEnrolled reflects whether an enrollment row exists', async () => {
      prisma.classStudent.findFirst.mockResolvedValueOnce({ id: 'cs' }).mockResolvedValueOnce(null);

      await expect(repo.isEnrolled({ userId: STUDENT_ID, classId: CLASS_ID })).resolves.toBe(true);
      await expect(repo.isEnrolled({ userId: STUDENT_ID, classId: CLASS_ID })).resolves.toBe(false);
      expect(prisma.classStudent.findFirst).toHaveBeenCalledWith({
        where: { classId: CLASS_ID, studentId: STUDENT_ID },
        select: { id: true },
      });
    });

    it('isParentOfEnrolled reflects whether a child is enrolled', async () => {
      prisma.classStudent.findFirst.mockResolvedValueOnce({ id: 'cs' }).mockResolvedValueOnce(null);

      await expect(repo.isParentOfEnrolled({ userId: USER_ID, classId: CLASS_ID })).resolves.toBe(
        true,
      );
      await expect(repo.isParentOfEnrolled({ userId: USER_ID, classId: CLASS_ID })).resolves.toBe(
        false,
      );
      expect(prisma.classStudent.findFirst).toHaveBeenCalledWith({
        where: { classId: CLASS_ID, student: { parentId: USER_ID } },
        select: { id: true },
      });
    });
  });

  describe('getSchedulesByClass', () => {
    it('returns the schedules of the class', async () => {
      prisma.schedule.findMany.mockResolvedValue([{ id: 'sch1' }]);

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
      prisma.classSession.findFirst.mockResolvedValueOnce(ongoing);

      await expect(repo.getRecentSessionByClass({ classId: CLASS_ID })).resolves.toBe(ongoing);
      expect(prisma.classSession.findFirst).toHaveBeenCalledTimes(1);
    });

    it('falls back to the soonest upcoming session when nothing is ongoing', async () => {
      prisma.classSession.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(upcoming);

      await expect(repo.getRecentSessionByClass({ classId: CLASS_ID })).resolves.toBe(upcoming);
      expect(prisma.classSession.findFirst).toHaveBeenCalledTimes(2);
    });

    it('falls back to the most recent past session when nothing is upcoming', async () => {
      prisma.classSession.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(past);

      await expect(repo.getRecentSessionByClass({ classId: CLASS_ID })).resolves.toBe(past);
      expect(prisma.classSession.findFirst).toHaveBeenCalledTimes(3);
    });

    it('returns null when the class has no sessions at all', async () => {
      prisma.classSession.findFirst.mockResolvedValue(null);

      await expect(repo.getRecentSessionByClass({ classId: CLASS_ID })).resolves.toBeNull();
    });
  });

  describe('getAllStudent', () => {
    it('returns the enrolled students with their parent', async () => {
      const student = { id: STUDENT_ID, parent: null };
      prisma.classStudent.findMany.mockResolvedValue([{ student }]);

      await expect(repo.getAllStudent({ id: CLASS_ID })).resolves.toEqual([student]);
      expect(prisma.classStudent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { classId: CLASS_ID } }),
      );
    });
  });
});
