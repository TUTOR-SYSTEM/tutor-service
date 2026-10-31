import { Prisma } from '@prisma/client';
import { ExerciseRepository } from 'src/features/exercise/exercise.repository';
import { createPrismaMock, PrismaMock } from '../../support/prisma.mock';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const STUDENT_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const CLASS_ID = '44444444-4444-4444-8444-444444444444';
const EX_ID = '55555555-5555-4555-8555-555555555555';

const notFound = () =>
  new Prisma.PrismaClientKnownRequestError('not found', { code: 'P2025', clientVersion: 'test' });

const row = (overrides: Record<string, unknown> = {}) => ({
  id: EX_ID,
  lessonId: null,
  sessionId: SESSION_ID,
  tutorId: USER_ID,
  studentId: STUDENT_ID,
  issueUrls: ['https://x/issue.pdf'],
  exerciseUrls: ['https://x/ex.pdf'],
  status: 'SUBMITTED',
  score: null,
  comment: null,
  gradedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
  ...overrides,
});

describe('ExerciseRepository', () => {
  let prisma: PrismaMock;
  let repo: ExerciseRepository;

  beforeEach(() => {
    prisma = createPrismaMock();
    repo = new ExerciseRepository(prisma as never);
  });

  describe('create', () => {
    it('inserts with defaults (SUBMITTED, empty url lists, null session/lesson)', async () => {
      prisma.exercise.create.mockResolvedValue(row());

      await repo.create({
        data: { tutorId: USER_ID, studentId: STUDENT_ID } as never,
      });

      expect(prisma.exercise.create).toHaveBeenCalledWith({
        data: {
          tutorId: USER_ID,
          studentId: STUDENT_ID,
          sessionId: null,
          lessonId: null,
          issueUrls: [],
          exerciseUrls: [],
          status: 'SUBMITTED',
        },
      });
    });

    it('returns the mapped DTO with ISO timestamps', async () => {
      prisma.exercise.create.mockResolvedValue(row());

      const result = await repo.create({
        data: { tutorId: USER_ID, studentId: STUDENT_ID } as never,
      });

      expect(result).toEqual(
        expect.objectContaining({
          id: EX_ID,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
          gradedAt: null,
          score: null,
        }),
      );
    });
  });

  describe('row mapping (via findById)', () => {
    it('converts a decimal score into a number', async () => {
      prisma.exercise.findUnique.mockResolvedValue(
        row({ score: new Prisma.Decimal('85.50'), gradedAt: new Date('2026-01-03T00:00:00Z') }),
      );

      const result = await repo.findById({ id: EX_ID });

      expect(result?.score).toBe(85.5);
      expect(result?.gradedAt).toBe('2026-01-03T00:00:00.000Z');
    });

    it('defaults null url arrays to empty arrays', async () => {
      prisma.exercise.findUnique.mockResolvedValue(row({ issueUrls: null, exerciseUrls: null }));

      const result = await repo.findById({ id: EX_ID });

      expect(result?.issueUrls).toEqual([]);
      expect(result?.exerciseUrls).toEqual([]);
    });
  });

  describe('findByStudentSession', () => {
    it('returns the mapped submission when one exists', async () => {
      prisma.exercise.findFirst.mockResolvedValue(row());

      const result = await repo.findByStudentSession({
        studentId: STUDENT_ID,
        sessionId: SESSION_ID,
      });

      expect(result?.id).toBe(EX_ID);
      expect(prisma.exercise.findFirst).toHaveBeenCalledWith({
        where: { studentId: STUDENT_ID, sessionId: SESSION_ID },
      });
    });

    it('returns null when the student has no submission for the session', async () => {
      prisma.exercise.findFirst.mockResolvedValue(null);

      await expect(
        repo.findByStudentSession({ studentId: STUDENT_ID, sessionId: SESSION_ID }),
      ).resolves.toBeNull();
    });
  });

  describe('findById', () => {
    it('returns null when the id does not exist', async () => {
      prisma.exercise.findUnique.mockResolvedValue(null);

      await expect(repo.findById({ id: EX_ID })).resolves.toBeNull();
    });
  });

  describe('findAll', () => {
    const baseQuery = { page: 2, limit: 5 } as never;
    const access = { OR: [{ tutorId: USER_ID }, { studentId: USER_ID }] };

    it('returns rows with nested session/class/student and pagination', async () => {
      prisma.exercise.count.mockResolvedValue(7);
      prisma.exercise.findMany.mockResolvedValue([
        {
          ...row({ score: new Prisma.Decimal('10') }),
          session: {
            id: SESSION_ID,
            sessionNumber: 3,
            classId: CLASS_ID,
            class: { id: CLASS_ID, name: 'Math', code: 'M9' },
          },
          student: { id: STUDENT_ID, firstName: 'A', lastName: 'B', userCode: 'U1', avatar: null },
        },
      ]);

      const result = await repo.findAll({ userId: USER_ID, query: baseQuery });

      expect(result.pagination).toEqual({ total: 7, page: 2, limit: 5, totalPages: 2 });
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual(
        expect.objectContaining({
          id: EX_ID,
          score: 10,
          session: { id: SESSION_ID, sessionNumber: 3, classId: CLASS_ID },
          class: { id: CLASS_ID, name: 'Math', code: 'M9' },
          student: expect.objectContaining({ id: STUDENT_ID }),
        }),
      );
      expect(prisma.exercise.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5, skip: 5 }), // (page 2 - 1) * limit 5
      );
    });

    it('nulls session and class when the exercise has no session', async () => {
      prisma.exercise.count.mockResolvedValue(1);
      prisma.exercise.findMany.mockResolvedValue([{ ...row(), session: null, student: null }]);

      const result = await repo.findAll({
        userId: USER_ID,
        query: { page: 1, limit: 10 } as never,
      });

      expect(result.data[0].session).toBeNull();
      expect(result.data[0].class).toBeNull();
      expect(result.data[0].student).toBeNull();
    });

    it('reports zero total and zero pages when there is nothing to show', async () => {
      prisma.exercise.count.mockResolvedValue(0);
      prisma.exercise.findMany.mockResolvedValue([]);

      const result = await repo.findAll({
        userId: USER_ID,
        query: { page: 1, limit: 10 } as never,
      });

      expect(result).toEqual({
        data: [],
        pagination: { total: 0, page: 1, limit: 10, totalPages: 0 },
      });
    });

    it('scopes to tutor-or-student access and applies the optional filters', async () => {
      prisma.exercise.count.mockResolvedValue(0);
      prisma.exercise.findMany.mockResolvedValue([]);

      await repo.findAll({
        userId: USER_ID,
        query: {
          page: 1,
          limit: 10,
          sessionId: SESSION_ID,
          studentId: STUDENT_ID,
          tutorId: USER_ID,
        } as never,
      });

      expect(prisma.exercise.count).toHaveBeenCalledWith({
        where: {
          AND: [access, { sessionId: SESSION_ID }, { studentId: STUDENT_ID }, { tutorId: USER_ID }],
        },
      });
    });

    it('filters by class through the exercise session relation', async () => {
      prisma.exercise.count.mockResolvedValue(0);
      prisma.exercise.findMany.mockResolvedValue([]);

      await repo.findAll({
        userId: USER_ID,
        query: { page: 1, limit: 10, classId: CLASS_ID } as never,
      });

      expect(prisma.exercise.count).toHaveBeenCalledWith({
        where: { AND: [access, { session: { classId: CLASS_ID } }] },
      });
    });
  });

  describe('update', () => {
    it('writes the given fields and returns the mapped row', async () => {
      prisma.exercise.update.mockResolvedValue(
        row({ status: 'GRADED', score: new Prisma.Decimal('9') }),
      );

      const result = await repo.update({
        id: EX_ID,
        data: { status: 'GRADED', score: '9' },
      });

      expect(prisma.exercise.update).toHaveBeenCalledWith({
        where: { id: EX_ID },
        data: { status: 'GRADED', score: '9' },
      });
      expect(result).toEqual(expect.objectContaining({ status: 'GRADED', score: 9 }));
    });

    it('returns null when no row was updated', async () => {
      prisma.exercise.update.mockRejectedValue(notFound());

      await expect(repo.update({ id: EX_ID, data: { comment: 'x' } })).resolves.toBeNull();
    });
  });
});
