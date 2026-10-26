import { Prisma } from '@prisma/client';
import { SessionRepository } from 'src/features/session/session.repository';
import { createPrismaMock, PrismaMock } from '../../support/prisma.mock';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CLASS_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const STUDENT_ID = '44444444-4444-4444-8444-444444444444';

const notFound = () =>
  new Prisma.PrismaClientKnownRequestError('not found', { code: 'P2025', clientVersion: 'test' });

describe('SessionRepository', () => {
  let prisma: PrismaMock;
  let repo: SessionRepository;

  beforeEach(() => {
    prisma = createPrismaMock();
    repo = new SessionRepository(prisma as never);
  });

  describe('create', () => {
    it('converts ISO date strings to Date objects and passes null/undefined through', async () => {
      prisma.classSession.create.mockResolvedValue({ id: SESSION_ID });

      await repo.create({
        data: {
          classId: CLASS_ID,
          sessionNumber: 1,
          startAt: '2026-04-01T08:00:00.000Z',
          endAt: '2026-04-01T09:30:00.000Z',
          actualStartAt: null,
          exerciseDueAt: undefined,
        } as never,
      });

      expect(prisma.classSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          classId: CLASS_ID,
          sessionNumber: 1,
          startAt: new Date('2026-04-01T08:00:00.000Z'),
          endAt: new Date('2026-04-01T09:30:00.000Z'),
          actualStartAt: null,
          exerciseDueAt: undefined,
        }),
      });
    });

    it('keeps Date instances as they are', async () => {
      const startAt = new Date('2026-04-02T08:00:00.000Z');
      prisma.classSession.create.mockResolvedValue({ id: SESSION_ID });

      await repo.create({ data: { startAt } as never });

      expect(prisma.classSession.create.mock.calls[0][0].data.startAt).toBe(startAt);
    });
  });

  describe('createMany', () => {
    it('converts date strings on every item and stamps the class id', async () => {
      prisma.classSession.createManyAndReturn.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);

      await repo.createMany({
        classId: CLASS_ID,
        items: [
          { sessionNumber: 1, startAt: '2026-05-01T00:00:00.000Z' },
          {
            sessionNumber: 2,
            startAt: '2026-05-08T00:00:00.000Z',
            exerciseDueAt: '2026-05-10T00:00:00.000Z',
          },
        ] as never,
      });

      expect(prisma.classSession.createManyAndReturn).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            classId: CLASS_ID,
            sessionNumber: 1,
            startAt: new Date('2026-05-01T00:00:00.000Z'),
          }),
          expect.objectContaining({
            classId: CLASS_ID,
            sessionNumber: 2,
            startAt: new Date('2026-05-08T00:00:00.000Z'),
            exerciseDueAt: new Date('2026-05-10T00:00:00.000Z'),
          }),
        ],
      });
    });
  });

  describe('getAll', () => {
    const access = {
      class: { OR: [{ tutorId: USER_ID }, { students: { some: { studentId: USER_ID } } }] },
    };

    it('returns sessions with nested class and pagination', async () => {
      const row = { id: SESSION_ID, classId: CLASS_ID, class: { id: CLASS_ID, name: 'Math' } };
      prisma.classSession.count.mockResolvedValue(4);
      prisma.classSession.findMany.mockResolvedValue([row]);

      const result = await repo.getAll({
        userId: USER_ID,
        query: { page: 1, limit: 3 } as never,
      });

      expect(result.sessions).toEqual([row]);
      expect(result.pagination).toEqual({ total: 4, page: 1, limit: 3, totalPages: 2 });
    });

    it('applies the search, status, classId and date-range filters', async () => {
      prisma.classSession.count.mockResolvedValue(0);
      prisma.classSession.findMany.mockResolvedValue([]);
      const startDate = new Date('2026-06-01T00:00:00.000Z');
      const endDate = new Date('2026-06-30T00:00:00.000Z');

      await repo.getAll({
        userId: USER_ID,
        query: {
          page: 1,
          limit: 10,
          search: 'algebra',
          status: 'SCHEDULED',
          classId: CLASS_ID,
          startDate,
          endDate,
        } as never,
      });

      expect(prisma.classSession.count).toHaveBeenCalledWith({
        where: {
          AND: [
            access,
            { startAt: { gte: startDate, lte: endDate } },
            {
              AND: [
                { OR: [{ title: { contains: 'algebra', mode: 'insensitive' } }] },
                { status: 'SCHEDULED' },
                { classId: CLASS_ID },
              ],
            },
          ],
        },
      });
    });

    it('converts ISO date strings from an RPC payload', async () => {
      prisma.classSession.count.mockResolvedValue(0);
      prisma.classSession.findMany.mockResolvedValue([]);

      await repo.getAll({
        userId: USER_ID,
        query: { startDate: '2026-06-01T00:00:00.000Z' } as never,
      });

      expect(prisma.classSession.count).toHaveBeenCalledWith({
        where: {
          AND: [access, { startAt: { gte: new Date('2026-06-01T00:00:00.000Z') } }],
        },
      });
    });

    it('omits the date clause when no range is given', async () => {
      prisma.classSession.count.mockResolvedValue(0);
      prisma.classSession.findMany.mockResolvedValue([]);

      await repo.getAll({ userId: USER_ID, query: { page: 1, limit: 10 } as never });

      expect(prisma.classSession.count).toHaveBeenCalledWith({ where: { AND: [access] } });
    });
  });

  describe('getByClass / getById', () => {
    it('getByClass returns the class sessions', async () => {
      prisma.classSession.findMany.mockResolvedValue([{ id: SESSION_ID }]);

      await expect(repo.getByClass({ classId: CLASS_ID })).resolves.toEqual([{ id: SESSION_ID }]);
    });

    it('getById returns null when missing', async () => {
      prisma.classSession.findUnique.mockResolvedValue(null);

      await expect(repo.getById({ id: SESSION_ID })).resolves.toBeNull();
    });
  });

  describe('getDetailById', () => {
    it('returns the session with class and lesson (incl. chapter title) nested', async () => {
      prisma.classSession.findUnique.mockResolvedValue({
        id: SESSION_ID,
        class: { id: CLASS_ID, name: 'Math' },
        lesson: { id: 'l1', title: 'Intro', chapter: { title: 'Ch 1' } },
      });

      await expect(repo.getDetailById({ id: SESSION_ID })).resolves.toEqual({
        id: SESSION_ID,
        class: { id: CLASS_ID, name: 'Math' },
        lesson: { id: 'l1', title: 'Intro', chapterTitle: 'Ch 1' },
      });
    });

    it('gives a null chapter title when the lesson has no chapter', async () => {
      prisma.classSession.findUnique.mockResolvedValue({
        id: SESSION_ID,
        class: { id: CLASS_ID },
        lesson: { id: 'l1', title: 'Intro', chapter: null },
      });

      const result = await repo.getDetailById({ id: SESSION_ID });

      expect(result?.lesson).toEqual({ id: 'l1', title: 'Intro', chapterTitle: null });
    });

    it('nulls the lesson when the session has none', async () => {
      prisma.classSession.findUnique.mockResolvedValue({
        id: SESSION_ID,
        class: { id: CLASS_ID },
        lesson: null,
      });

      const result = await repo.getDetailById({ id: SESSION_ID });

      expect(result?.lesson).toBeNull();
    });

    it('returns null when the session does not exist', async () => {
      prisma.classSession.findUnique.mockResolvedValue(null);

      await expect(repo.getDetailById({ id: SESSION_ID })).resolves.toBeNull();
    });
  });

  describe('isEnrolled / isParentOfEnrolled', () => {
    it('isEnrolled is true when an enrollment row exists', async () => {
      prisma.classStudent.findFirst.mockResolvedValue({ id: 'cs1' });

      await expect(repo.isEnrolled({ userId: STUDENT_ID, classId: CLASS_ID })).resolves.toBe(true);
      expect(prisma.classStudent.findFirst).toHaveBeenCalledWith({
        where: { classId: CLASS_ID, studentId: STUDENT_ID },
        select: { id: true },
      });
    });

    it('isEnrolled is false when there is no enrollment', async () => {
      prisma.classStudent.findFirst.mockResolvedValue(null);

      await expect(repo.isEnrolled({ userId: STUDENT_ID, classId: CLASS_ID })).resolves.toBe(false);
    });

    it('isParentOfEnrolled matches students whose parent is the user', async () => {
      prisma.classStudent.findFirst.mockResolvedValue({ id: 'cs1' });

      await expect(repo.isParentOfEnrolled({ userId: USER_ID, classId: CLASS_ID })).resolves.toBe(
        true,
      );
      expect(prisma.classStudent.findFirst).toHaveBeenCalledWith({
        where: { classId: CLASS_ID, student: { parentId: USER_ID } },
        select: { id: true },
      });
    });

    it('isParentOfEnrolled is false when no child is enrolled', async () => {
      prisma.classStudent.findFirst.mockResolvedValue(null);

      await expect(repo.isParentOfEnrolled({ userId: USER_ID, classId: CLASS_ID })).resolves.toBe(
        false,
      );
    });
  });

  describe('update', () => {
    it('converts date fields and leaves undefined ones out of the write', async () => {
      prisma.classSession.update.mockResolvedValue({ id: SESSION_ID });

      await repo.update({
        id: SESSION_ID,
        data: { title: 'New', startAt: '2026-07-01T00:00:00.000Z', endAt: undefined } as never,
      });

      const { where, data } = prisma.classSession.update.mock.calls[0][0];
      expect(where).toEqual({ id: SESSION_ID });
      expect(data).toEqual(
        expect.objectContaining({ title: 'New', startAt: new Date('2026-07-01T00:00:00.000Z') }),
      );
      expect(data.endAt).toBeUndefined();
    });

    it('returns null when the session does not exist', async () => {
      prisma.classSession.update.mockRejectedValue(notFound());

      await expect(repo.update({ id: SESSION_ID, data: {} as never })).resolves.toBeNull();
    });
  });

  describe('del', () => {
    it('returns true when a row was deleted and false otherwise', async () => {
      prisma.classSession.deleteMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      await expect(repo.del({ id: SESSION_ID })).resolves.toBe(true);
      await expect(repo.del({ id: SESSION_ID })).resolves.toBe(false);
      expect(prisma.classSession.deleteMany).toHaveBeenCalledWith({ where: { id: SESSION_ID } });
    });
  });
});
