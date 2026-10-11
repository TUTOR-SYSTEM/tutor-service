import { ScheduleRepository } from 'src/features/schedule/schedule.repository';
import { classes, classStudents, schedules } from 'src/database/schema';
import { createDrizzleMock, DrizzleMock, lastWhere, renderSql } from '../../support/drizzle.mock';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CLASS_ID = '22222222-2222-4222-8222-222222222222';
const SCHEDULE_ID = '33333333-3333-4333-8333-333333333333';

const item = {
  dayOfWeek: 1,
  startTime: '08:00',
  endTime: '09:30',
  format: 'ONLINE',
  location: 'Room 1',
};

describe('ScheduleRepository', () => {
  let db: DrizzleMock;
  let repo: ScheduleRepository;

  beforeEach(() => {
    db = createDrizzleMock();
    repo = new ScheduleRepository(db as never);
  });

  describe('create', () => {
    it('inserts one schedule row and returns it', async () => {
      db.queue([{ id: SCHEDULE_ID, classId: CLASS_ID }]);

      const result = await repo.create({ data: { classId: CLASS_ID, ...item } as never });

      expect(result).toEqual({ id: SCHEDULE_ID, classId: CLASS_ID });
      expect(db.insert).toHaveBeenCalledWith(schedules);
      expect(db.values).toHaveBeenCalledWith({ classId: CLASS_ID, ...item });
    });
  });

  describe('createMany', () => {
    it('does one multi-row insert stamping every item with the class id', async () => {
      const rows = [{ id: 'a' }, { id: 'b' }];
      db.queue(rows);

      const result = await repo.createMany({
        classId: CLASS_ID,
        items: [item, { ...item, dayOfWeek: 3 }] as never,
      });

      expect(result).toEqual(rows);
      expect(db.insert).toHaveBeenCalledTimes(1);
      expect(db.values).toHaveBeenCalledWith([
        { classId: CLASS_ID, ...item },
        { classId: CLASS_ID, ...item, dayOfWeek: 3 },
      ]);
    });
  });

  describe('getAll', () => {
    it('returns schedules with their class nested and pagination', async () => {
      db.queue(
        [{ total: '12' }],
        [
          {
            schedule: { id: SCHEDULE_ID, classId: CLASS_ID, dayOfWeek: 1 },
            class: { id: CLASS_ID, name: 'Math', code: 'M9', subject: 'MATH' },
          },
        ],
      );

      const result = await repo.getAll({
        userId: USER_ID,
        query: { page: '2', limit: '5' } as never,
      });

      expect(result.schedules).toEqual([
        {
          id: SCHEDULE_ID,
          classId: CLASS_ID,
          dayOfWeek: 1,
          class: { id: CLASS_ID, name: 'Math', code: 'M9', subject: 'MATH' },
        },
      ]);
      expect(result.pagination).toEqual({ total: 12, page: 2, limit: 5, totalPages: 3 });
      expect(db.limit).toHaveBeenCalledWith(5);
      expect(db.offset).toHaveBeenCalledWith(5);
    });

    it('defaults to page 1 and limit 10 when the query omits them', async () => {
      db.queue([{ total: 0 }], []);

      const result = await repo.getAll({ userId: USER_ID, query: {} as never });

      expect(result.pagination).toEqual({ total: 0, page: 1, limit: 10, totalPages: 0 });
      expect(db.limit).toHaveBeenCalledWith(10);
      expect(db.offset).toHaveBeenCalledWith(0);
    });

    it('limits access to owned or enrolled classes and applies search and classId filters', async () => {
      db.queue([{ total: 0 }], []);

      await repo.getAll({
        userId: USER_ID,
        query: { search: ' room ', classId: CLASS_ID } as never,
      });

      const { sql, params } = renderSql(lastWhere(db));
      // owned/enrolled class ids come from two subqueries
      expect(db.select).toHaveBeenCalledWith({ id: classes.id });
      expect(db.select).toHaveBeenCalledWith({ id: classStudents.classId });
      expect(sql).toContain('ilike');
      expect(params).toEqual(expect.arrayContaining(['%room%', CLASS_ID]));
    });
  });

  describe('getByClass / getById', () => {
    it('getByClass returns every schedule of the class', async () => {
      const rows = [{ id: 'a' }];
      db.queue(rows);

      await expect(repo.getByClass({ classId: CLASS_ID })).resolves.toEqual(rows);
      expect(db.orderBy).toHaveBeenCalled();
    });

    it('getById returns the first row', async () => {
      db.queue([{ id: SCHEDULE_ID }]);

      await expect(repo.getById({ id: SCHEDULE_ID })).resolves.toEqual({ id: SCHEDULE_ID });
    });

    it('getById returns undefined when nothing matches', async () => {
      db.queue([]);

      await expect(repo.getById({ id: SCHEDULE_ID })).resolves.toBeUndefined();
    });
  });

  describe('update', () => {
    it('sets the provided fields with a fresh updatedAt and returns the row', async () => {
      db.queue([{ id: SCHEDULE_ID, location: 'Room 2' }]);

      const result = await repo.update({
        id: SCHEDULE_ID,
        data: { location: 'Room 2' } as never,
      });

      expect(result).toEqual({ id: SCHEDULE_ID, location: 'Room 2' });
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({ location: 'Room 2', updatedAt: expect.any(Date) }),
      );
    });

    it('returns undefined when the schedule does not exist', async () => {
      db.queue([]);

      await expect(repo.update({ id: SCHEDULE_ID, data: {} as never })).resolves.toBeUndefined();
    });
  });

  describe('del', () => {
    it('returns true when a row was deleted', async () => {
      db.queue([{ id: SCHEDULE_ID }]);

      await expect(repo.del({ id: SCHEDULE_ID })).resolves.toBe(true);
      expect(db.delete).toHaveBeenCalledWith(schedules);
    });

    it('returns false when nothing was deleted', async () => {
      db.queue([]);

      await expect(repo.del({ id: SCHEDULE_ID })).resolves.toBe(false);
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
