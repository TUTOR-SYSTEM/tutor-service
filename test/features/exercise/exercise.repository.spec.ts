import { ExerciseRepository } from 'src/features/exercise/exercise.repository';
import { exercise, sessions } from 'src/database/schema';
import { createDrizzleMock, DrizzleMock, lastWhere, renderSql } from '../../support/drizzle.mock';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const STUDENT_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const CLASS_ID = '44444444-4444-4444-8444-444444444444';
const EX_ID = '55555555-5555-4555-8555-555555555555';

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
  let db: DrizzleMock;
  let repo: ExerciseRepository;

  beforeEach(() => {
    db = createDrizzleMock();
    repo = new ExerciseRepository(db as never);
  });

  describe('create', () => {
    it('inserts with defaults (SUBMITTED, empty url lists, null session/lesson)', async () => {
      db.queue([row()]);

      await repo.create({
        data: { tutorId: USER_ID, studentId: STUDENT_ID } as never,
      });

      expect(db.values).toHaveBeenCalledWith({
        tutorId: USER_ID,
        studentId: STUDENT_ID,
        sessionId: null,
        lessonId: null,
        issueUrls: [],
        exerciseUrls: [],
        status: 'SUBMITTED',
      });
    });

    it('returns the mapped DTO with ISO timestamps', async () => {
      db.queue([row()]);

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
    it('converts a numeric string score into a number', async () => {
      db.queue([row({ score: '85.50', gradedAt: new Date('2026-01-03T00:00:00Z') })]);

      const result = await repo.findById({ id: EX_ID });

      expect(result?.score).toBe(85.5);
      expect(result?.gradedAt).toBe('2026-01-03T00:00:00.000Z');
    });

    it('defaults null url arrays to empty arrays', async () => {
      db.queue([row({ issueUrls: null, exerciseUrls: null })]);

      const result = await repo.findById({ id: EX_ID });

      expect(result?.issueUrls).toEqual([]);
      expect(result?.exerciseUrls).toEqual([]);
    });
  });

  describe('findByStudentSession', () => {
    it('returns the mapped submission when one exists', async () => {
      db.queue([row()]);

      const result = await repo.findByStudentSession({
        studentId: STUDENT_ID,
        sessionId: SESSION_ID,
      });

      expect(result?.id).toBe(EX_ID);
      expect(db.limit).toHaveBeenCalledWith(1);
    });

    it('returns null when the student has no submission for the session', async () => {
      db.queue([]);

      await expect(
        repo.findByStudentSession({ studentId: STUDENT_ID, sessionId: SESSION_ID }),
      ).resolves.toBeNull();
    });
  });

  describe('findById', () => {
    it('returns null when the id does not exist', async () => {
      db.queue([]);

      await expect(repo.findById({ id: EX_ID })).resolves.toBeNull();
    });
  });

  describe('findAll', () => {
    const baseQuery = { page: 2, limit: 5 } as never;

    it('returns rows with nested session/class/student and pagination', async () => {
      db.queue(
        [{ total: '7' }],
        [
          {
            exercise: row({ score: '10' }),
            session: { id: SESSION_ID, sessionNumber: 3, classId: CLASS_ID },
            class: { id: CLASS_ID, name: 'Math', code: 'M9' },
            student: {
              id: STUDENT_ID,
              firstName: 'A',
              lastName: 'B',
              userCode: 'U1',
              avatar: null,
            },
          },
        ],
      );

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
      expect(db.limit).toHaveBeenCalledWith(5);
      expect(db.offset).toHaveBeenCalledWith(5); // (page 2 - 1) * limit 5
    });

    it('nulls session and class when the joined ids are missing', async () => {
      db.queue(
        [{ total: 1 }],
        [
          {
            exercise: row(),
            session: { id: null, sessionNumber: null, classId: null },
            class: { id: null, name: null, code: null },
            student: null,
          },
        ],
      );

      const result = await repo.findAll({
        userId: USER_ID,
        query: { page: 1, limit: 10 } as never,
      });

      expect(result.data[0].session).toBeNull();
      expect(result.data[0].class).toBeNull();
      expect(result.data[0].student).toBeNull();
    });

    it('reports zero total and zero pages when there is nothing to show', async () => {
      db.queue([{ total: 0 }], []);

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
      db.queue([{ total: 0 }], []);

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

      const { sql, params } = renderSql(lastWhere(db));
      expect(sql).toContain('"exercises"."tutor_id" = ');
      expect(sql).toContain('"exercises"."student_id" = ');
      expect(sql).toContain('"exercises"."session_id" = ');
      expect(params).toEqual(expect.arrayContaining([USER_ID, SESSION_ID, STUDENT_ID]));
    });

    it('filters by class through a subquery over the class sessions', async () => {
      db.queue([{ total: 0 }], []);

      await repo.findAll({
        userId: USER_ID,
        query: { page: 1, limit: 10, classId: CLASS_ID } as never,
      });

      const { sql, params } = renderSql(lastWhere(db));
      // the class-to-session ids come from a subquery built on `sessions`
      expect(db.select).toHaveBeenCalledWith({ id: sessions.id });
      expect(params).toContain(USER_ID);
    });
  });

  describe('update', () => {
    it('sets the given fields plus updatedAt and returns the mapped row', async () => {
      db.queue([row({ status: 'GRADED', score: '9' })]);

      const result = await repo.update({
        id: EX_ID,
        data: { status: 'GRADED', score: '9' },
      });

      expect(db.set).toHaveBeenCalledWith({
        status: 'GRADED',
        score: '9',
        updatedAt: expect.any(Date),
      });
      expect(result).toEqual(expect.objectContaining({ status: 'GRADED', score: 9 }));
      expect(db.update).toHaveBeenCalledWith(exercise);
    });

    it('returns null when no row was updated', async () => {
      db.queue([]);

      await expect(repo.update({ id: EX_ID, data: { comment: 'x' } })).resolves.toBeNull();
    });
  });

  describe('findAll count fallback', () => {
    it('reports a zero total when the count query returns no row', async () => {
      db.queue([], []);

      const result = await repo.findAll({
        userId: USER_ID,
        query: { page: 1, limit: 10 } as never,
      });

      expect(result.pagination.total).toBe(0);
    });
  });
});
