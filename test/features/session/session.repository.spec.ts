import { SessionRepository } from 'src/features/session/session.repository';
import { sessions } from 'src/database/schema';
import { createDrizzleMock, DrizzleMock, lastWhere, renderSql } from '../../support/drizzle.mock';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CLASS_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const STUDENT_ID = '44444444-4444-4444-8444-444444444444';

describe('SessionRepository', () => {
  let db: DrizzleMock;
  let repo: SessionRepository;

  beforeEach(() => {
    db = createDrizzleMock();
    repo = new SessionRepository(db as never);
  });

  describe('create', () => {
    it('converts ISO date strings to Date objects and passes null/undefined through', async () => {
      db.queue([{ id: SESSION_ID }]);

      await repo.create({
        data: {
          classId: CLASS_ID,
          startAt: '2026-04-01T08:00:00.000Z',
          endAt: '2026-04-01T09:30:00.000Z',
          actualStartAt: null,
          exerciseDueAt: undefined,
        } as never,
      });

      expect(db.insert).toHaveBeenCalledWith(sessions);
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          classId: CLASS_ID,
          startAt: new Date('2026-04-01T08:00:00.000Z'),
          endAt: new Date('2026-04-01T09:30:00.000Z'),
          actualStartAt: null,
          exerciseDueAt: undefined,
        }),
      );
    });

    it('keeps Date instances as they are', async () => {
      const startAt = new Date('2026-04-02T08:00:00.000Z');
      db.queue([{ id: SESSION_ID }]);

      await repo.create({ data: { startAt } as never });

      expect(db.values.mock.calls[0][0].startAt).toBe(startAt);
    });
  });

  describe('createMany', () => {
    it('converts date strings on every item of the bulk insert', async () => {
      db.queue([{ id: 'a' }, { id: 'b' }]);

      await repo.createMany({
        items: [
          { classId: CLASS_ID, startAt: '2026-05-01T00:00:00.000Z' },
          {
            classId: CLASS_ID,
            startAt: '2026-05-08T00:00:00.000Z',
            exerciseDueAt: '2026-05-10T00:00:00.000Z',
          },
        ] as never,
      });

      expect(db.values).toHaveBeenCalledWith([
        expect.objectContaining({ startAt: new Date('2026-05-01T00:00:00.000Z') }),
        expect.objectContaining({
          startAt: new Date('2026-05-08T00:00:00.000Z'),
          exerciseDueAt: new Date('2026-05-10T00:00:00.000Z'),
        }),
      ]);
    });
  });

  describe('getAll', () => {
    it('returns sessions with nested class and pagination', async () => {
      db.queue(
        [{ total: 4 }],
        [{ session: { id: SESSION_ID, classId: CLASS_ID }, class: { id: CLASS_ID, name: 'Math' } }],
      );

      const result = await repo.getAll({
        userId: USER_ID,
        query: { page: 1, limit: 3 } as never,
      });

      expect(result.sessions).toEqual([
        { id: SESSION_ID, classId: CLASS_ID, class: { id: CLASS_ID, name: 'Math' } },
      ]);
      expect(result.pagination).toEqual({ total: 4, page: 1, limit: 3, totalPages: 2 });
    });

    it('applies the search, status, classId and date-range filters', async () => {
      db.queue([{ total: 0 }], []);
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

      const { sql, params } = renderSql(lastWhere(db));
      expect(sql).toContain('ilike');
      expect(sql).toContain('"class_sessions"."start_at" >= ');
      expect(sql).toContain('"class_sessions"."start_at" <= ');
      expect(params).toEqual(
        expect.arrayContaining([
          '%algebra%',
          'SCHEDULED',
          CLASS_ID,
          '2026-06-01T00:00:00.000Z',
          '2026-06-30T00:00:00.000Z',
        ]),
      );
    });

    it('omits the date clauses when no range is given', async () => {
      db.queue([{ total: 0 }], []);

      await repo.getAll({ userId: USER_ID, query: { page: 1, limit: 10 } as never });

      const { sql } = renderSql(lastWhere(db));
      expect(sql).not.toContain('"class_sessions"."start_at"');
    });
  });

  describe('getByClass / getById', () => {
    it('getByClass returns the class sessions', async () => {
      db.queue([{ id: SESSION_ID }]);

      await expect(repo.getByClass({ classId: CLASS_ID })).resolves.toEqual([{ id: SESSION_ID }]);
    });

    it('getById returns undefined when missing', async () => {
      db.queue([]);

      await expect(repo.getById({ id: SESSION_ID })).resolves.toBeUndefined();
    });
  });

  describe('getDetailById', () => {
    it('returns the session with class and lesson nested', async () => {
      db.queue([
        {
          session: { id: SESSION_ID },
          class: { id: CLASS_ID, name: 'Math' },
          lesson: { id: 'l1', title: 'Intro', chapterTitle: 'Ch 1' },
        },
      ]);

      await expect(repo.getDetailById({ id: SESSION_ID })).resolves.toEqual({
        id: SESSION_ID,
        class: { id: CLASS_ID, name: 'Math' },
        lesson: { id: 'l1', title: 'Intro', chapterTitle: 'Ch 1' },
      });
    });

    it('nulls the lesson when the session has none', async () => {
      db.queue([{ session: { id: SESSION_ID }, class: { id: CLASS_ID }, lesson: { id: null } }]);

      const result = await repo.getDetailById({ id: SESSION_ID });

      expect(result?.lesson).toBeNull();
    });

    it('returns null when the session does not exist', async () => {
      db.queue([]);

      await expect(repo.getDetailById({ id: SESSION_ID })).resolves.toBeNull();
    });
  });

  describe('isEnrolled / isParentOfEnrolled', () => {
    it('isEnrolled is true when an enrollment row exists', async () => {
      db.queue([{ id: 'cs1' }]);

      await expect(repo.isEnrolled({ userId: STUDENT_ID, classId: CLASS_ID })).resolves.toBe(true);
    });

    it('isEnrolled is false when there is no enrollment', async () => {
      db.queue([]);

      await expect(repo.isEnrolled({ userId: STUDENT_ID, classId: CLASS_ID })).resolves.toBe(false);
    });

    it('isParentOfEnrolled joins users on parent_id and returns true on a match', async () => {
      db.queue([{ id: 'cs1' }]);

      await expect(repo.isParentOfEnrolled({ userId: USER_ID, classId: CLASS_ID })).resolves.toBe(
        true,
      );
      expect(db.innerJoin).toHaveBeenCalled();
      const { params } = renderSql(lastWhere(db));
      expect(params).toEqual(expect.arrayContaining([CLASS_ID, USER_ID]));
    });

    it('isParentOfEnrolled is false when no child is enrolled', async () => {
      db.queue([]);

      await expect(repo.isParentOfEnrolled({ userId: USER_ID, classId: CLASS_ID })).resolves.toBe(
        false,
      );
    });
  });

  describe('update', () => {
    it('converts date fields, keeps undefined ones out of the set and bumps updatedAt', async () => {
      db.queue([{ id: SESSION_ID }]);

      await repo.update({
        id: SESSION_ID,
        data: { title: 'New', startAt: '2026-07-01T00:00:00.000Z', endAt: undefined } as never,
      });

      const setArg = db.set.mock.calls[0][0];
      expect(setArg).toEqual(
        expect.objectContaining({
          title: 'New',
          startAt: new Date('2026-07-01T00:00:00.000Z'),
          updatedAt: expect.any(Date),
        }),
      );
      expect(setArg.endAt).toBeUndefined();
    });

    it('returns undefined when the session does not exist', async () => {
      db.queue([]);

      await expect(repo.update({ id: SESSION_ID, data: {} as never })).resolves.toBeUndefined();
    });
  });

  describe('del', () => {
    it('returns true when a row was deleted and false otherwise', async () => {
      db.queue([{ id: SESSION_ID }], []);

      await expect(repo.del({ id: SESSION_ID })).resolves.toBe(true);
      await expect(repo.del({ id: SESSION_ID })).resolves.toBe(false);
      expect(db.delete).toHaveBeenCalledWith(sessions);
    });
  });

  describe('getAll count fallback', () => {
    it('reports a zero total when the count query returns no row', async () => {
      db.queue([], []);

      const result = await repo.getAll({ userId: USER_ID, query: {} as never });

      expect(result.pagination.total).toBe(0);
    });
  });
});
