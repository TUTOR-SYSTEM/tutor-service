import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ERROR_MESSAGES } from 'src/data/constants';
import { TuitionService } from 'src/features/tuition/tuition.service';
import { TuitionRepository } from 'src/features/tuition/tuition.repository';

const TUTOR_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TUTOR_ID = '22222222-2222-4222-8222-222222222222';
const CLASS_ID = '33333333-3333-4333-8333-333333333333';
const TUITION_ID = '44444444-4444-4444-8444-444444444444';
const STUDENT_ID = '66666666-6666-4666-8666-666666666666';

describe('TuitionService', () => {
  let service: TuitionService;
  let repo: Record<string, jest.Mock>;

  beforeEach(async () => {
    repo = {
      create: jest.fn(),
      findAll: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      getClassTutorId: jest.fn().mockResolvedValue(TUTOR_ID),
      isStudentEnrolled: jest.fn().mockResolvedValue(true),
      findOwnerById: jest.fn().mockResolvedValue({ id: TUITION_ID, tutorId: TUTOR_ID }),
      getSummary: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [TuitionService, { provide: TuitionRepository, useValue: repo }],
    }).compile();

    service = module.get(TuitionService);
  });

  describe('create', () => {
    it('creates the tuition when the tutor owns the class', async () => {
      repo.create.mockResolvedValue({ id: TUITION_ID });

      const result = await service.create(
        { classId: CLASS_ID, studentId: STUDENT_ID } as never,
        TUTOR_ID,
      );

      expect(repo.getClassTutorId).toHaveBeenCalledWith(CLASS_ID);
      expect(repo.create).toHaveBeenCalledWith({ classId: CLASS_ID, studentId: STUDENT_ID });
      expect(result).toEqual({ id: TUITION_ID });
    });

    // regression (TUT3-05): a studentId outside the class must not get a tuition (and its profile)
    it('returns BadRequest and inserts nothing when the student is not enrolled in the class', async () => {
      repo.isStudentEnrolled.mockResolvedValue(false);

      await expect(
        service.create({ classId: CLASS_ID, studentId: STUDENT_ID } as never, TUTOR_ID),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.STUDENT_NOT_IN_CLASS));
      expect(repo.isStudentEnrolled).toHaveBeenCalledWith({
        classId: CLASS_ID,
        studentId: STUDENT_ID,
      });
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('returns NotFound and inserts nothing when another tutor owns the class', async () => {
      repo.getClassTutorId.mockResolvedValue(OTHER_TUTOR_ID);

      await expect(service.create({ classId: CLASS_ID } as never, TUTOR_ID)).rejects.toThrow(
        new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND),
      );
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('returns NotFound when the class does not exist (tutorId lookup is null)', async () => {
      repo.getClassTutorId.mockResolvedValue(null);

      await expect(service.create({ classId: CLASS_ID } as never, TUTOR_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects a non-UUID tutorId', async () => {
      await expect(service.create({ classId: CLASS_ID } as never, 'x')).rejects.toThrow(
        new BadRequestException(ERROR_MESSAGES.TUTOR_ID_INVALID),
      );
      expect(repo.getClassTutorId).not.toHaveBeenCalled();
    });

    it('rejects a missing or non-UUID classId', async () => {
      await expect(service.create({ classId: '' } as never, TUTOR_ID)).rejects.toThrow(
        new BadRequestException(ERROR_MESSAGES.CLASS_ID_INVALID),
      );
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('returns the tuition scoped to the acting user', async () => {
      repo.findById.mockResolvedValue({ id: TUITION_ID });

      await expect(service.findById({ userId: TUTOR_ID, id: TUITION_ID })).resolves.toEqual({
        id: TUITION_ID,
      });
      expect(repo.findById).toHaveBeenCalledWith(TUITION_ID, TUTOR_ID);
    });

    it('returns NotFound when the user cannot see it (repo returns nothing)', async () => {
      repo.findById.mockResolvedValue(undefined);

      await expect(service.findById({ userId: TUTOR_ID, id: TUITION_ID })).rejects.toThrow(
        new NotFoundException(ERROR_MESSAGES.TUITION_RECORD_NOT_FOUND),
      );
    });

    it('rejects a non-UUID id', async () => {
      await expect(service.findById({ userId: TUTOR_ID, id: 'x' })).rejects.toThrow(
        new BadRequestException(ERROR_MESSAGES.ID_MUST_BE_UUID),
      );
      expect(repo.findById).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates when the tutor owns the record', async () => {
      repo.update.mockResolvedValue({ id: TUITION_ID, amount: 100 });

      await expect(service.update(TUITION_ID, { amount: 100 } as never, TUTOR_ID)).resolves.toEqual(
        { id: TUITION_ID, amount: 100 },
      );
      expect(repo.update).toHaveBeenCalledWith(TUITION_ID, { amount: 100 });
    });

    // regression (TUT3-42): re-saving an already-PAID tuition must not overwrite the payment date
    it('keeps the original paidDate when the tuition is already PAID', async () => {
      repo.findOwnerById.mockResolvedValue({ id: TUITION_ID, tutorId: TUTOR_ID, status: 'PAID' });
      repo.update.mockResolvedValue({ id: TUITION_ID });

      await service.update(TUITION_ID, { status: 'PAID' } as never, TUTOR_ID);

      expect(repo.update).toHaveBeenCalledWith(TUITION_ID, { status: 'PAID' });
    });

    it('stamps paidDate when a tuition transitions into PAID', async () => {
      repo.findOwnerById.mockResolvedValue({ id: TUITION_ID, tutorId: TUTOR_ID, status: 'UNPAID' });
      repo.update.mockResolvedValue({ id: TUITION_ID });

      await service.update(TUITION_ID, { status: 'PAID' } as never, TUTOR_ID);

      expect(repo.update).toHaveBeenCalledWith(TUITION_ID, {
        status: 'PAID',
        paidDate: expect.any(Date),
      });
    });

    it('hides records owned by another tutor as NotFound and does not update', async () => {
      repo.findOwnerById.mockResolvedValue({ id: TUITION_ID, tutorId: OTHER_TUTOR_ID });

      await expect(service.update(TUITION_ID, {} as never, TUTOR_ID)).rejects.toThrow(
        new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND),
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('returns NotFound for a missing record', async () => {
      repo.findOwnerById.mockResolvedValue(null);

      await expect(service.update(TUITION_ID, {} as never, TUTOR_ID)).rejects.toThrow(
        new NotFoundException(ERROR_MESSAGES.TUITION_RECORD_NOT_FOUND),
      );
    });

    it('rejects a non-UUID tutorId before lookup', async () => {
      await expect(service.update(TUITION_ID, {} as never, '')).rejects.toThrow(
        new BadRequestException(ERROR_MESSAGES.TUTOR_ID_INVALID),
      );
      expect(repo.findOwnerById).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('deletes the owned record and returns its id', async () => {
      await expect(service.delete(TUITION_ID, TUTOR_ID)).resolves.toEqual({ id: TUITION_ID });
      expect(repo.delete).toHaveBeenCalledWith(TUITION_ID);
    });

    it('does not delete a record owned by another tutor', async () => {
      repo.findOwnerById.mockResolvedValue({ id: TUITION_ID, tutorId: OTHER_TUTOR_ID });

      await expect(service.delete(TUITION_ID, TUTOR_ID)).rejects.toThrow(NotFoundException);
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('rejects a non-UUID record id', async () => {
      await expect(service.delete('bad', TUTOR_ID)).rejects.toThrow(BadRequestException);
      expect(repo.findOwnerById).not.toHaveBeenCalled();
    });
  });

  describe('getSummary', () => {
    it('passes an optional classId through once validated', async () => {
      repo.getSummary.mockResolvedValue({ total: 1 });

      await expect(service.getSummary({ userId: TUTOR_ID, classId: CLASS_ID })).resolves.toEqual({
        total: 1,
      });
      expect(repo.getSummary).toHaveBeenCalledWith({ userId: TUTOR_ID, classId: CLASS_ID });
    });

    it('rejects a malformed classId', async () => {
      await expect(service.getSummary({ userId: TUTOR_ID, classId: 'bad' })).rejects.toThrow(
        new BadRequestException(ERROR_MESSAGES.CLASS_ID_INVALID),
      );
      expect(repo.getSummary).not.toHaveBeenCalled();
    });

    it('allows omitting classId entirely', async () => {
      repo.getSummary.mockResolvedValue({});

      await service.getSummary({ userId: TUTOR_ID });

      expect(repo.getSummary).toHaveBeenCalledWith({ userId: TUTOR_ID, classId: undefined });
    });
  });

  describe('findAll', () => {
    it('rejects a non-UUID userId before querying', async () => {
      await expect(service.findAll({ userId: 'nope', query: {} as never })).rejects.toThrow(
        new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID),
      );
      expect(repo.findAll).not.toHaveBeenCalled();
    });

    it('forwards the acting user and query to the repository', async () => {
      const query = { page: 1, limit: 10 } as never;
      repo.findAll.mockResolvedValue({ tuitions: [], pagination: { total: 0 } });

      await expect(service.findAll({ userId: TUTOR_ID, query })).resolves.toEqual({
        tuitions: [],
        pagination: { total: 0 },
      });
      expect(repo.findAll).toHaveBeenCalledWith({ userId: TUTOR_ID, query });
    });
  });

  describe('update and delete guards', () => {
    it.each([
      ['update', (svc: TuitionService) => svc.update('nope', {} as never, TUTOR_ID)],
      ['delete', (svc: TuitionService) => svc.delete('nope', TUTOR_ID)],
    ])('%s rejects a non-UUID record id before lookup', async (_name, call) => {
      await expect(call(service)).rejects.toThrow(
        new BadRequestException(ERROR_MESSAGES.ID_MUST_BE_UUID),
      );
      expect(repo.findOwnerById).not.toHaveBeenCalled();
    });

    it.each([
      ['update', (svc: TuitionService) => svc.update(TUITION_ID, {} as never, '')],
      ['delete', (svc: TuitionService) => svc.delete(TUITION_ID, '')],
    ])('%s rejects an empty tutorId before lookup', async (_name, call) => {
      await expect(call(service)).rejects.toThrow(
        new BadRequestException(ERROR_MESSAGES.TUTOR_ID_INVALID),
      );
      expect(repo.findOwnerById).not.toHaveBeenCalled();
    });
  });

  describe('delete missing record', () => {
    it('returns NotFound and deletes nothing when the record does not exist', async () => {
      repo.findOwnerById.mockResolvedValue(null);

      await expect(service.delete(TUITION_ID, TUTOR_ID)).rejects.toThrow(
        new NotFoundException(ERROR_MESSAGES.TUITION_RECORD_NOT_FOUND),
      );
      expect(repo.delete).not.toHaveBeenCalled();
    });
  });
});
