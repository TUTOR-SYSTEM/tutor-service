import { AttendanceRepository } from 'src/features/attendance/attendance.repository';
import { createPrismaMock, PrismaMock } from '../../support/prisma.mock';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const STUDENT_ID = '22222222-2222-4222-8222-222222222222';

describe('AttendanceRepository', () => {
  let prisma: PrismaMock;
  let repo: AttendanceRepository;

  beforeEach(() => {
    prisma = createPrismaMock();
    repo = new AttendanceRepository(prisma as never);
  });

  describe('findBySession', () => {
    it('lists attendances filtered by session id and returns the rows', async () => {
      const rows = [{ id: 'a1' }, { id: 'a2' }];
      prisma.attendance.findMany.mockResolvedValue(rows);

      await expect(repo.findBySession({ sessionId: SESSION_ID })).resolves.toEqual(rows);
      expect(prisma.attendance.findMany).toHaveBeenCalledWith({ where: { sessionId: SESSION_ID } });
    });
  });

  describe('findOne', () => {
    it('looks the row up by the (sessionId, studentId) unique key', async () => {
      prisma.attendance.findUnique.mockResolvedValue({ id: 'a1' });

      await expect(repo.findOne({ sessionId: SESSION_ID, studentId: STUDENT_ID })).resolves.toEqual(
        expect.objectContaining({ id: 'a1' }),
      );
      expect(prisma.attendance.findUnique).toHaveBeenCalledWith({
        where: { sessionId_studentId: { sessionId: SESSION_ID, studentId: STUDENT_ID } },
      });
    });

    it('returns null when there is no matching row', async () => {
      prisma.attendance.findUnique.mockResolvedValue(null);

      await expect(
        repo.findOne({ sessionId: SESSION_ID, studentId: STUDENT_ID }),
      ).resolves.toBeNull();
    });
  });

  describe('upsert', () => {
    it('upserts on (sessionId, studentId) with a null note by default', async () => {
      prisma.attendance.upsert.mockResolvedValue({ id: 'a1', present: true });

      const result = await repo.upsert({
        data: { sessionId: SESSION_ID, studentId: STUDENT_ID, present: true } as never,
      });

      expect(result).toEqual({ id: 'a1', present: true });
      expect(prisma.attendance.upsert).toHaveBeenCalledWith({
        where: { sessionId_studentId: { sessionId: SESSION_ID, studentId: STUDENT_ID } },
        create: { sessionId: SESSION_ID, studentId: STUDENT_ID, present: true, note: null },
        update: { present: true, note: null },
      });
    });

    it('keeps the note when one is provided', async () => {
      prisma.attendance.upsert.mockResolvedValue({ id: 'a1' });

      await repo.upsert({
        data: {
          sessionId: SESSION_ID,
          studentId: STUDENT_ID,
          present: false,
          note: 'late',
        } as never,
      });

      expect(prisma.attendance.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ note: 'late', present: false }),
          update: { present: false, note: 'late' },
        }),
      );
    });
  });
});
