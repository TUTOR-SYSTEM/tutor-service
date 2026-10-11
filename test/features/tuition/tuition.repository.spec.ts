import { TuitionRepository } from 'src/features/tuition/tuition.repository';
import { tuitions } from 'src/database/schema';
import { createDrizzleMock, DrizzleMock, lastWhere, renderSql } from '../../support/drizzle.mock';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CLASS_ID = '22222222-2222-4222-8222-222222222222';
const STUDENT_ID = '33333333-3333-4333-8333-333333333333';
const TUITION_ID = '44444444-4444-4444-8444-444444444444';

const joinedRow = (overrides: Record<string, unknown> = {}) => ({
  tuition: {
    id: TUITION_ID,
    classId: CLASS_ID,
    studentId: STUDENT_ID,
    amount: '500000.00',
    status: 'UNPAID',
    dueDate: null,
    paidDate: null,
    note: null,
  },
  className: 'Math',
  classCode: 'M9',
  studentFirstName: 'An',
  studentLastName: 'Nguyen',
  studentUserCode: 'U1',
  studentPhone: null,
  studentAvatar: null,
  ...overrides,
});

describe('TuitionRepository', () => {
  let db: DrizzleMock;
  let repo: TuitionRepository;

  beforeEach(() => {
    db = createDrizzleMock();
    repo = new TuitionRepository(db as never);
  });

  describe('create', () => {
    it('stringifies amount, defaults status to UNPAID and returns the joined row', async () => {
      db.queue([{ id: TUITION_ID }], [joinedRow()]);

      const result = await repo.create({
        classId: CLASS_ID,
        studentId: STUDENT_ID,
        amount: 500000,
      } as never);

      expect(db.values).toHaveBeenCalledWith({
        classId: CLASS_ID,
        studentId: STUDENT_ID,
        amount: '500000',
        dueDate: null,
        paidDate: null,
        status: 'UNPAID',
        note: null,
      });
      expect(result).toEqual(expect.objectContaining({ id: TUITION_ID, amount: '500000.00' }));
    });

    it('converts ISO date strings from the RPC payload into Date objects', async () => {
      db.queue([{ id: TUITION_ID }], [joinedRow()]);

      await repo.create({
        classId: CLASS_ID,
        studentId: STUDENT_ID,
        amount: 1,
        dueDate: '2026-02-01T00:00:00.000Z',
        paidDate: '2026-01-20T00:00:00.000Z',
      } as never);

      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          dueDate: new Date('2026-02-01T00:00:00.000Z'),
          paidDate: new Date('2026-01-20T00:00:00.000Z'),
        }),
      );
    });
  });

  describe('findAll', () => {
    it('returns serialized rows with nested class and student plus pagination', async () => {
      db.queue([{ total: '3' }], [joinedRow()]);

      const result = await repo.findAll({
        userId: USER_ID,
        query: { page: 1, limit: 2 } as never,
      });

      expect(result.pagination).toEqual({ total: 3, page: 1, limit: 2, totalPages: 2 });
      expect(result.tuitions[0]).toEqual(
        expect.objectContaining({
          amount: '500000.00',
          class: { id: CLASS_ID, name: 'Math', code: 'M9' },
          student: expect.objectContaining({ id: STUDENT_ID, firstName: 'An', lastName: 'Nguyen' }),
        }),
      );
      expect(db.limit).toHaveBeenCalledWith(2);
      expect(db.offset).toHaveBeenCalledWith(0);
    });

    it('applies classId, studentId and status filters on top of the access rule', async () => {
      db.queue([{ total: 0 }], []);

      await repo.findAll({
        userId: USER_ID,
        query: {
          page: 1,
          limit: 10,
          classId: CLASS_ID,
          studentId: STUDENT_ID,
          status: 'PAID',
        } as never,
      });

      const { sql, params } = renderSql(lastWhere(db));
      expect(sql).toContain('"tuitions"."student_id" = ');
      expect(sql).toContain('"tuitions"."class_id" in');
      expect(params).toEqual(expect.arrayContaining([CLASS_ID, STUDENT_ID, 'PAID', USER_ID]));
    });
  });

  describe('serialize (via findById)', () => {
    it('falls back to amount "0" when the stored amount is null', async () => {
      db.queue([joinedRow({ tuition: { ...joinedRow().tuition, amount: null } })]);

      const result = await repo.findById(TUITION_ID);

      expect(result?.amount).toBe('0');
    });
  });

  describe('findById', () => {
    it('returns null when the tuition does not exist', async () => {
      db.queue([]);

      await expect(repo.findById(TUITION_ID)).resolves.toBeNull();
    });

    it('adds the read-access rule when a userId is given', async () => {
      db.queue([joinedRow()]);

      await repo.findById(TUITION_ID, USER_ID);

      const { sql, params } = renderSql(lastWhere(db));
      expect(sql).toContain('"tuitions"."student_id" = ');
      expect(params).toContain(USER_ID);
    });

    it('does not add the access rule when no userId is given', async () => {
      db.queue([joinedRow()]);

      await repo.findById(TUITION_ID);

      const { sql } = renderSql(lastWhere(db));
      expect(sql).not.toContain('"student_id"');
    });
  });

  describe('update', () => {
    it('returns null without re-reading when no row was updated', async () => {
      db.queue([]);

      await expect(repo.update(TUITION_ID, { status: 'PAID' })).resolves.toBeNull();
      expect(db.select).not.toHaveBeenCalled();
    });

    it('sets the fields with updatedAt and returns the re-read row', async () => {
      db.queue(
        [{ id: TUITION_ID }],
        [joinedRow({ tuition: { ...joinedRow().tuition, status: 'PAID' } })],
      );

      const result = await repo.update(TUITION_ID, { status: 'PAID' });

      expect(db.set).toHaveBeenCalledWith({ status: 'PAID', updatedAt: expect.any(Date) });
      expect(result?.status).toBe('PAID');
    });

    // Regression check: create() converts RPC date strings with toDate(), update() does not.
    // Drizzle's timestamp column calls toISOString() on write, so a raw string would crash.
    it('converts ISO date strings in dueDate/paidDate into Date objects', async () => {
      db.queue([{ id: TUITION_ID }], [joinedRow()]);

      await repo.update(TUITION_ID, {
        dueDate: '2026-03-01T00:00:00.000Z',
        paidDate: '2026-02-25T00:00:00.000Z',
      });

      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({
          dueDate: new Date('2026-03-01T00:00:00.000Z'),
          paidDate: new Date('2026-02-25T00:00:00.000Z'),
        }),
      );
    });
  });

  describe('delete', () => {
    it('returns true when a row was deleted', async () => {
      db.queue([{ id: TUITION_ID }]);

      await expect(repo.delete(TUITION_ID)).resolves.toBe(true);
      expect(db.delete).toHaveBeenCalledWith(tuitions);
    });

    it('returns false when nothing was deleted', async () => {
      db.queue([]);

      await expect(repo.delete(TUITION_ID)).resolves.toBe(false);
    });
  });

  describe('getClassTutorId', () => {
    it('returns the tutor id of the class', async () => {
      db.queue([{ tutorId: USER_ID }]);

      await expect(repo.getClassTutorId(CLASS_ID)).resolves.toBe(USER_ID);
    });

    it('returns null when the class is missing', async () => {
      db.queue([]);

      await expect(repo.getClassTutorId(CLASS_ID)).resolves.toBeNull();
    });
  });

  describe('findOwnerById', () => {
    it('returns the tuition id with the owning tutor', async () => {
      db.queue([{ id: TUITION_ID, tutorId: USER_ID }]);

      await expect(repo.findOwnerById(TUITION_ID)).resolves.toEqual({
        id: TUITION_ID,
        tutorId: USER_ID,
      });
    });

    it('returns null when the tuition is missing', async () => {
      db.queue([]);

      await expect(repo.findOwnerById(TUITION_ID)).resolves.toBeNull();
    });
  });

  describe('getSummary', () => {
    it('maps grouped totals to paid/unpaid/overdue and reports paid as revenue', async () => {
      db.queue([
        { status: 'PAID', total: '1000.00' },
        { status: 'UNPAID', total: '250.50' },
        { status: 'OVERDUE', total: '75' },
      ]);

      const result = await repo.getSummary({ userId: USER_ID });

      expect(result).toEqual({
        totalPaid: 1000,
        totalUnpaid: 250.5,
        totalOverdue: 75,
        totalRevenue: 1000,
      });
      expect(db.groupBy).toHaveBeenCalledWith(tuitions.status);
    });

    it('returns zeros for statuses with no rows', async () => {
      db.queue([]);

      await expect(repo.getSummary({ userId: USER_ID })).resolves.toEqual({
        totalPaid: 0,
        totalUnpaid: 0,
        totalOverdue: 0,
        totalRevenue: 0,
      });
    });

    it('narrows to one class when classId is given', async () => {
      db.queue([]);

      await repo.getSummary({ userId: USER_ID, classId: CLASS_ID });

      const { params } = renderSql(lastWhere(db));
      expect(params).toContain(CLASS_ID);
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
