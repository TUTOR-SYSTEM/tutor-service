import { Prisma } from '@prisma/client';
import { ScheduleRepository } from 'src/features/schedule/schedule.repository';
import { createPrismaMock, PrismaMock } from '../../support/prisma.mock';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CLASS_ID = '22222222-2222-4222-8222-222222222222';
const SCHEDULE_ID = '33333333-3333-4333-8333-333333333333';

const item = {
  dayOfWeek: 'MONDAY',
  startTime: '08:00',
  endTime: '09:30',
  format: 'ONLINE',
  location: 'Room 1',
};

const notFound = () =>
  new Prisma.PrismaClientKnownRequestError('not found', { code: 'P2025', clientVersion: 'test' });

describe('ScheduleRepository', () => {
  let prisma: PrismaMock;
  let repo: ScheduleRepository;

  beforeEach(() => {
    prisma = createPrismaMock();
    repo = new ScheduleRepository(prisma as never);
  });

  describe('create', () => {
    it('inserts one schedule row and returns it', async () => {
      prisma.schedule.create.mockResolvedValue({ id: SCHEDULE_ID, classId: CLASS_ID });

      const result = await repo.create({ data: { classId: CLASS_ID, ...item } as never });

      expect(result).toEqual({ id: SCHEDULE_ID, classId: CLASS_ID });
      expect(prisma.schedule.create).toHaveBeenCalledWith({ data: { classId: CLASS_ID, ...item } });
    });
  });

  describe('createMany', () => {
    it('does one multi-row insert stamping every item with the class id', async () => {
      const rows = [{ id: 'a' }, { id: 'b' }];
      prisma.schedule.createManyAndReturn.mockResolvedValue(rows);

      const result = await repo.createMany({
        classId: CLASS_ID,
        items: [item, { ...item, dayOfWeek: 'WEDNESDAY' }] as never,
      });

      expect(result).toEqual(rows);
      expect(prisma.schedule.createManyAndReturn).toHaveBeenCalledTimes(1);
      expect(prisma.schedule.createManyAndReturn).toHaveBeenCalledWith({
        data: [
          { classId: CLASS_ID, ...item },
          { classId: CLASS_ID, ...item, dayOfWeek: 'WEDNESDAY' },
        ],
      });
    });
  });

  describe('getAll', () => {
    it('returns schedules with their class nested and pagination', async () => {
      const row = {
        id: SCHEDULE_ID,
        classId: CLASS_ID,
        dayOfWeek: 'MONDAY',
        class: { id: CLASS_ID, name: 'Math', code: 'M9', subject: 'MATH' },
      };
      prisma.schedule.count.mockResolvedValue(12);
      prisma.schedule.findMany.mockResolvedValue([row]);

      const result = await repo.getAll({
        userId: USER_ID,
        query: { page: '2', limit: '5' } as never,
      });

      expect(result.schedules).toEqual([row]);
      expect(result.pagination).toEqual({ total: 12, page: 2, limit: 5, totalPages: 3 });
      expect(prisma.schedule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5, skip: 5 }),
      );
    });

    it('defaults to page 1 and limit 10 when the query omits them', async () => {
      prisma.schedule.count.mockResolvedValue(0);
      prisma.schedule.findMany.mockResolvedValue([]);

      const result = await repo.getAll({ userId: USER_ID, query: {} as never });

      expect(result.pagination).toEqual({ total: 0, page: 1, limit: 10, totalPages: 0 });
      expect(prisma.schedule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10, skip: 0 }),
      );
    });

    it('limits access to owned or enrolled classes and applies search and classId filters', async () => {
      prisma.schedule.count.mockResolvedValue(0);
      prisma.schedule.findMany.mockResolvedValue([]);

      await repo.getAll({
        userId: USER_ID,
        query: { search: ' room ', classId: CLASS_ID } as never,
      });

      const expectedWhere = {
        AND: [
          {
            class: { OR: [{ tutorId: USER_ID }, { students: { some: { studentId: USER_ID } } }] },
          },
          {
            AND: [
              { OR: [{ location: { contains: 'room', mode: 'insensitive' } }] },
              { classId: CLASS_ID },
            ],
          },
        ],
      };
      expect(prisma.schedule.count).toHaveBeenCalledWith({ where: expectedWhere });
      expect(prisma.schedule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
    });
  });

  describe('getByClass / getById', () => {
    it('getByClass returns every schedule of the class ordered by day and start time', async () => {
      const rows = [{ id: 'a' }];
      prisma.schedule.findMany.mockResolvedValue(rows);

      await expect(repo.getByClass({ classId: CLASS_ID })).resolves.toEqual(rows);
      expect(prisma.schedule.findMany).toHaveBeenCalledWith({
        where: { classId: CLASS_ID },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      });
    });

    it('getById returns the row', async () => {
      prisma.schedule.findUnique.mockResolvedValue({ id: SCHEDULE_ID });

      await expect(repo.getById({ id: SCHEDULE_ID })).resolves.toEqual({ id: SCHEDULE_ID });
    });

    it('getById returns null when nothing matches', async () => {
      prisma.schedule.findUnique.mockResolvedValue(null);

      await expect(repo.getById({ id: SCHEDULE_ID })).resolves.toBeNull();
    });
  });

  describe('update', () => {
    it('writes the provided fields and returns the row', async () => {
      prisma.schedule.update.mockResolvedValue({ id: SCHEDULE_ID, location: 'Room 2' });

      const result = await repo.update({
        id: SCHEDULE_ID,
        data: { location: 'Room 2' } as never,
      });

      expect(result).toEqual({ id: SCHEDULE_ID, location: 'Room 2' });
      expect(prisma.schedule.update).toHaveBeenCalledWith({
        where: { id: SCHEDULE_ID },
        data: expect.objectContaining({ location: 'Room 2' }),
      });
    });

    it('returns null when the schedule does not exist', async () => {
      prisma.schedule.update.mockRejectedValue(notFound());

      await expect(repo.update({ id: SCHEDULE_ID, data: {} as never })).resolves.toBeNull();
    });

    it('rethrows unexpected errors', async () => {
      prisma.schedule.update.mockRejectedValue(new Error('boom'));

      await expect(repo.update({ id: SCHEDULE_ID, data: {} as never })).rejects.toThrow('boom');
    });
  });

  describe('del', () => {
    it('returns true when a row was deleted', async () => {
      prisma.schedule.deleteMany.mockResolvedValue({ count: 1 });

      await expect(repo.del({ id: SCHEDULE_ID })).resolves.toBe(true);
      expect(prisma.schedule.deleteMany).toHaveBeenCalledWith({ where: { id: SCHEDULE_ID } });
    });

    it('returns false when nothing was deleted', async () => {
      prisma.schedule.deleteMany.mockResolvedValue({ count: 0 });

      await expect(repo.del({ id: SCHEDULE_ID })).resolves.toBe(false);
    });
  });
});
