import { Prisma } from '@prisma/client';
import { TuitionRepository } from 'src/features/tuition/tuition.repository';
import { createPrismaMock, PrismaMock } from '../../support/prisma.mock';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CLASS_ID = '22222222-2222-4222-8222-222222222222';
const STUDENT_ID = '33333333-3333-4333-8333-333333333333';
const TUITION_ID = '44444444-4444-4444-8444-444444444444';

const notFound = () =>
  new Prisma.PrismaClientKnownRequestError('not found', { code: 'P2025', clientVersion: 'test' });

const READ_ACCESS = { OR: [{ studentId: USER_ID }, { class: { tutorId: USER_ID } }] };

const row = (overrides: Record<string, unknown> = {}) => ({
  id: TUITION_ID,
  classId: CLASS_ID,
  studentId: STUDENT_ID,
  amount: new Prisma.Decimal('500000'),
  status: 'UNPAID',
  dueDate: null,
  paidDate: null,
  note: null,
  class: { name: 'Math', code: 'M9' },
  student: {
    firstName: 'An',
    lastName: 'Nguyen',
    userCode: 'U1',
    phone: null,
    avatar: null,
  },
  ...overrides,
});

describe('TuitionRepository', () => {
  let prisma: PrismaMock;
  let repo: TuitionRepository;

  beforeEach(() => {
    prisma = createPrismaMock();
    repo = new TuitionRepository(prisma as never);
  });

  describe('create', () => {
    it('stringifies amount, defaults status to UNPAID and returns the joined row', async () => {
      prisma.tuition.create.mockResolvedValue({ id: TUITION_ID });
      prisma.tuition.findFirst.mockResolvedValue(row());

      const result = await repo.create({
        classId: CLASS_ID,
        studentId: STUDENT_ID,
        amount: 500000,
      } as never);

      expect(prisma.tuition.create).toHaveBeenCalledWith({
        data: {
          classId: CLASS_ID,
          studentId: STUDENT_ID,
          amount: '500000',
          dueDate: null,
          paidDate: null,
          status: 'UNPAID',
          note: null,
        },
      });
      expect(result).toEqual(expect.objectContaining({ id: TUITION_ID, amount: '500000.00' }));
    });

    it('converts ISO date strings from the RPC payload into Date objects', async () => {
      prisma.tuition.create.mockResolvedValue({ id: TUITION_ID });
      prisma.tuition.findFirst.mockResolvedValue(row());

      await repo.create({
        classId: CLASS_ID,
        studentId: STUDENT_ID,
        amount: 1,
        dueDate: '2026-02-01T00:00:00.000Z',
        paidDate: '2026-01-20T00:00:00.000Z',
      } as never);

      expect(prisma.tuition.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          dueDate: new Date('2026-02-01T00:00:00.000Z'),
          paidDate: new Date('2026-01-20T00:00:00.000Z'),
        }),
      });
    });
  });

  describe('findAll', () => {
    it('returns serialized rows with nested class and student plus pagination', async () => {
      prisma.tuition.count.mockResolvedValue(3);
      prisma.tuition.findMany.mockResolvedValue([row()]);

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
      expect(prisma.tuition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 2, skip: 0, orderBy: { createdAt: 'desc' } }),
      );
    });

    it('applies classId, studentId and status filters on top of the access rule', async () => {
      prisma.tuition.count.mockResolvedValue(0);
      prisma.tuition.findMany.mockResolvedValue([]);

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

      expect(prisma.tuition.count).toHaveBeenCalledWith({
        where: {
          AND: [READ_ACCESS, { classId: CLASS_ID, studentId: STUDENT_ID, status: 'PAID' }],
        },
      });
    });
  });

  describe('serialize (via findById)', () => {
    it('falls back to amount "0" when the stored amount is null', async () => {
      prisma.tuition.findFirst.mockResolvedValue(row({ amount: null }));

      const result = await repo.findById(TUITION_ID);

      expect(result?.amount).toBe('0');
    });
  });

  describe('findById', () => {
    it('returns null when the tuition does not exist', async () => {
      prisma.tuition.findFirst.mockResolvedValue(null);

      await expect(repo.findById(TUITION_ID)).resolves.toBeNull();
    });

    it('adds the read-access rule when a userId is given', async () => {
      prisma.tuition.findFirst.mockResolvedValue(row());

      await repo.findById(TUITION_ID, USER_ID);

      expect(prisma.tuition.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: TUITION_ID, ...READ_ACCESS } }),
      );
    });

    it('does not add the access rule when no userId is given', async () => {
      prisma.tuition.findFirst.mockResolvedValue(row());

      await repo.findById(TUITION_ID);

      expect(prisma.tuition.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: TUITION_ID } }),
      );
    });
  });

  describe('update', () => {
    it('returns null without re-reading when no row was updated', async () => {
      prisma.tuition.update.mockRejectedValue(notFound());

      await expect(repo.update(TUITION_ID, { status: 'PAID' })).resolves.toBeNull();
      expect(prisma.tuition.findFirst).not.toHaveBeenCalled();
    });

    it('writes only the provided fields and returns the re-read row', async () => {
      prisma.tuition.update.mockResolvedValue({ id: TUITION_ID });
      prisma.tuition.findFirst.mockResolvedValue(row({ status: 'PAID' }));

      const result = await repo.update(TUITION_ID, { status: 'PAID' });

      expect(prisma.tuition.update).toHaveBeenCalledWith({
        where: { id: TUITION_ID },
        data: { status: 'PAID' },
      });
      expect(result?.status).toBe('PAID');
    });

    it('converts ISO date strings in dueDate/paidDate into Date objects', async () => {
      prisma.tuition.update.mockResolvedValue({ id: TUITION_ID });
      prisma.tuition.findFirst.mockResolvedValue(row());

      await repo.update(TUITION_ID, {
        dueDate: '2026-03-01T00:00:00.000Z',
        paidDate: '2026-02-25T00:00:00.000Z',
      });

      expect(prisma.tuition.update).toHaveBeenCalledWith({
        where: { id: TUITION_ID },
        data: {
          dueDate: new Date('2026-03-01T00:00:00.000Z'),
          paidDate: new Date('2026-02-25T00:00:00.000Z'),
        },
      });
    });

    it('rethrows unexpected errors', async () => {
      prisma.tuition.update.mockRejectedValue(new Error('boom'));

      await expect(repo.update(TUITION_ID, { status: 'PAID' })).rejects.toThrow('boom');
    });
  });

  describe('delete', () => {
    it('returns true when a row was deleted', async () => {
      prisma.tuition.deleteMany.mockResolvedValue({ count: 1 });

      await expect(repo.delete(TUITION_ID)).resolves.toBe(true);
      expect(prisma.tuition.deleteMany).toHaveBeenCalledWith({ where: { id: TUITION_ID } });
    });

    it('returns false when nothing was deleted', async () => {
      prisma.tuition.deleteMany.mockResolvedValue({ count: 0 });

      await expect(repo.delete(TUITION_ID)).resolves.toBe(false);
    });
  });

  describe('getClassTutorId', () => {
    it('returns the tutor id of the class', async () => {
      prisma.class.findUnique.mockResolvedValue({ tutorId: USER_ID });

      await expect(repo.getClassTutorId(CLASS_ID)).resolves.toBe(USER_ID);
    });

    it('returns null when the class is missing', async () => {
      prisma.class.findUnique.mockResolvedValue(null);

      await expect(repo.getClassTutorId(CLASS_ID)).resolves.toBeNull();
    });
  });

  describe('findOwnerById', () => {
    it('returns the tuition id with the owning tutor and status', async () => {
      prisma.tuition.findUnique.mockResolvedValue({
        id: TUITION_ID,
        status: 'PAID',
        class: { tutorId: USER_ID },
      });

      await expect(repo.findOwnerById(TUITION_ID)).resolves.toEqual({
        id: TUITION_ID,
        tutorId: USER_ID,
        status: 'PAID',
      });
    });

    it('returns null when the tuition is missing', async () => {
      prisma.tuition.findUnique.mockResolvedValue(null);

      await expect(repo.findOwnerById(TUITION_ID)).resolves.toBeNull();
    });
  });

  describe('getSummary', () => {
    const group = (status: string, total: string) => ({
      status,
      _sum: { amount: new Prisma.Decimal(total) },
    });

    it('maps grouped totals to paid/unpaid/overdue and reports paid as revenue', async () => {
      prisma.tuition.groupBy.mockResolvedValue([
        group('PAID', '1000.00'),
        group('UNPAID', '250.50'),
        group('OVERDUE', '75'),
      ]);

      const result = await repo.getSummary({ userId: USER_ID });

      expect(result).toEqual({
        totalPaid: 1000,
        totalUnpaid: 250.5,
        totalOverdue: 75,
        totalRevenue: 1000,
      });
      expect(prisma.tuition.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ by: ['status'] }),
      );
    });

    it('returns zeros for statuses with no rows', async () => {
      prisma.tuition.groupBy.mockResolvedValue([]);

      await expect(repo.getSummary({ userId: USER_ID })).resolves.toEqual({
        totalPaid: 0,
        totalUnpaid: 0,
        totalOverdue: 0,
        totalRevenue: 0,
      });
    });

    it('scopes to the tutor and narrows to one class when classId is given', async () => {
      prisma.tuition.groupBy.mockResolvedValue([]);

      await repo.getSummary({ userId: USER_ID, classId: CLASS_ID });

      expect(prisma.tuition.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { class: { tutorId: USER_ID }, classId: CLASS_ID },
        }),
      );
    });
  });
});
