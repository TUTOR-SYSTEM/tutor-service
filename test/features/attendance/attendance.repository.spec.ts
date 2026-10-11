import { AttendanceRepository } from 'src/features/attendance/attendance.repository';
import { attendances } from 'src/database/schema';
import { createDrizzleMock, DrizzleMock } from '../../support/drizzle.mock';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const STUDENT_ID = '22222222-2222-4222-8222-222222222222';

describe('AttendanceRepository', () => {
  let db: DrizzleMock;
  let repo: AttendanceRepository;

  beforeEach(() => {
    db = createDrizzleMock();
    repo = new AttendanceRepository(db as never);
  });

  describe('findBySession', () => {
    it('selects from attendances filtered by session id and returns the rows', async () => {
      const rows = [{ id: 'a1' }, { id: 'a2' }];
      db.queue(rows);

      await expect(repo.findBySession({ sessionId: SESSION_ID })).resolves.toEqual(rows);
      expect(db.select).toHaveBeenCalled();
      expect(db.from).toHaveBeenCalledWith(attendances);
      expect(db.where).toHaveBeenCalledTimes(1);
    });
  });

  describe('findOne', () => {
    it('returns the first matching row', async () => {
      db.queue([{ id: 'a1', sessionId: SESSION_ID, studentId: STUDENT_ID }]);

      await expect(repo.findOne({ sessionId: SESSION_ID, studentId: STUDENT_ID })).resolves.toEqual(
        expect.objectContaining({ id: 'a1' }),
      );
      expect(db.limit).toHaveBeenCalledWith(1);
    });

    it('returns null when there is no matching row', async () => {
      db.queue([]);

      await expect(
        repo.findOne({ sessionId: SESSION_ID, studentId: STUDENT_ID }),
      ).resolves.toBeNull();
    });
  });

  describe('upsert', () => {
    it('inserts the row and conflicts on (sessionId, studentId)', async () => {
      db.queue([{ id: 'a1', present: true }]);

      const result = await repo.upsert({
        data: { sessionId: SESSION_ID, studentId: STUDENT_ID, present: true } as never,
      });

      expect(result).toEqual({ id: 'a1', present: true });
      expect(db.values).toHaveBeenCalledWith({
        sessionId: SESSION_ID,
        studentId: STUDENT_ID,
        present: true,
        note: null,
      });
      expect(db.onConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          target: [attendances.sessionId, attendances.studentId],
          set: expect.objectContaining({ present: true, note: null, updatedAt: expect.any(Date) }),
        }),
      );
    });

    it('keeps the note when one is provided', async () => {
      db.queue([{ id: 'a1' }]);

      await repo.upsert({
        data: {
          sessionId: SESSION_ID,
          studentId: STUDENT_ID,
          present: false,
          note: 'late',
        } as never,
      });

      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({ note: 'late', present: false }),
      );
      expect(db.onConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ set: expect.objectContaining({ note: 'late' }) }),
      );
    });
  });
});
