import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ERROR_MESSAGES } from 'src/data/constants';
import { ClassService } from 'src/features/class/class.service';
import { ClassRepository } from 'src/features/class/class.repository';
import { UserService } from 'src/features/user/user.service';

// class.repository pulls drizzle + an ESM-only transitive dep (uuid) that jest cannot parse;
// the service only needs the repository token, so swap the module for a bare class
jest.mock('src/features/class/class.repository', () => ({
  ClassRepository: class ClassRepository {},
}));

const TUTOR_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TUTOR_ID = '22222222-2222-4222-8222-222222222222';
const CLASS_ID = '33333333-3333-4333-8333-333333333333';
const STUDENT_A = '44444444-4444-4444-8444-444444444444';
const STUDENT_B = '55555555-5555-4555-8555-555555555555';

const createDto = { name: 'Math 9', code: 'M9', tutorId: TUTOR_ID } as never;

describe('ClassService', () => {
  let service: ClassService;
  let repo: Record<string, jest.Mock>;
  let user: { userExists: jest.Mock; getUserRoleById: jest.Mock; getUserRolesByIds: jest.Mock };

  beforeEach(async () => {
    repo = {
      getClassByField: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      syncStudents: jest.fn(),
      getClasses: jest.fn(),
      getClass: jest.fn(),
      getAllStudent: jest.fn(),
      delClass: jest.fn(),
      hasTuitionHistory: jest.fn().mockResolvedValue(false),
      isEnrolled: jest.fn().mockResolvedValue(false),
      isParentOfEnrolled: jest.fn().mockResolvedValue(false),
      addStudents: jest.fn(),
      getMaterials: jest.fn(),
      getSchedulesByClass: jest.fn().mockResolvedValue([]),
      getRecentSessionByClass: jest.fn().mockResolvedValue(null),
    };
    user = {
      userExists: jest.fn().mockResolvedValue(true),
      getUserRoleById: jest.fn().mockResolvedValue({ id: TUTOR_ID, role: 'TUTOR' }),
      getUserRolesByIds: jest.fn().mockResolvedValue([
        { id: STUDENT_A, role: 'STUDENT' },
        { id: STUDENT_B, role: 'STUDENT' },
      ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClassService,
        { provide: ClassRepository, useValue: repo },
        { provide: UserService, useValue: user },
      ],
    }).compile();

    service = module.get(ClassService);
  });

  describe('createClassService', () => {
    it('creates the class when name, code and tutor are all free and valid', async () => {
      repo.create.mockResolvedValue({ id: CLASS_ID });

      await expect(
        service.createClassService({ userId: TUTOR_ID, data: createDto }),
      ).resolves.toEqual({ id: CLASS_ID });
      expect(repo.create).toHaveBeenCalledWith({ data: createDto });
    });

    it('rejects a duplicate name before inserting', async () => {
      repo.getClassByField.mockImplementation(async ({ field }: { field: string }) =>
        field === 'name' ? { id: 'other' } : null,
      );

      await expect(
        service.createClassService({ userId: TUTOR_ID, data: createDto }),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.CLASS_NAME_EXISTS));
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate code before inserting', async () => {
      repo.getClassByField.mockImplementation(async ({ field }: { field: string }) =>
        field === 'code' ? { id: 'other' } : null,
      );

      await expect(
        service.createClassService({ userId: TUTOR_ID, data: createDto }),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.CLASS_CODE_EXISTS));
    });

    it('rejects a tutor id that does not exist (admin assigning a tutor)', async () => {
      user.getUserRoleById.mockImplementation(async (id: string) =>
        id === TUTOR_ID ? { id, role: 'ADMIN' } : null,
      );

      await expect(
        service.createClassService({
          userId: TUTOR_ID,
          data: { ...createDto, tutorId: OTHER_TUTOR_ID },
        }),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.TUTOR_NOT_FOUND));
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('lets an admin assign an existing tutor', async () => {
      user.getUserRoleById.mockImplementation(async (id: string) => ({
        id,
        role: id === TUTOR_ID ? 'ADMIN' : 'TUTOR',
      }));
      repo.create.mockResolvedValue({ id: CLASS_ID });

      await expect(
        service.createClassService({
          userId: TUTOR_ID,
          data: { ...createDto, tutorId: OTHER_TUTOR_ID },
        }),
      ).resolves.toEqual({ id: CLASS_ID });
    });

    it.each(['STUDENT', 'PARENT'])(
      'forbids a %s from creating a class (no self-assigned tutor privileges)',
      async (role) => {
        user.getUserRoleById.mockResolvedValue({ id: TUTOR_ID, role });

        await expect(
          service.createClassService({ userId: TUTOR_ID, data: createDto }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(repo.create).not.toHaveBeenCalled();
      },
    );

    it('forbids a tutor from creating a class on behalf of another tutor', async () => {
      await expect(
        service.createClassService({
          userId: TUTOR_ID,
          data: { ...createDto, tutorId: OTHER_TUTOR_ID },
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('rejects an admin assigning a user who is not a tutor', async () => {
      user.getUserRoleById.mockImplementation(async (id: string) => ({
        id,
        role: id === TUTOR_ID ? 'ADMIN' : 'STUDENT',
      }));

      await expect(
        service.createClassService({
          userId: TUTOR_ID,
          data: { ...createDto, tutorId: OTHER_TUTOR_ID },
        }),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.TUTOR_NOT_FOUND));
    });

    it('maps a unique-violation race on name back to the name-exists error', async () => {
      const pgErr = Object.assign(new Error('dup'), { code: '23505' });
      repo.create.mockRejectedValue(pgErr);
      repo.getClassByField
        .mockResolvedValueOnce(null) // pre-check: name
        .mockResolvedValueOnce(null) // pre-check: code
        .mockResolvedValueOnce({ id: 'winner' }); // after the race: name now exists

      await expect(
        service.createClassService({ userId: TUTOR_ID, data: createDto }),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.CLASS_NAME_EXISTS));
    });

    it('maps a unique-violation (drizzle-wrapped in cause) on code to the code-exists error', async () => {
      repo.create.mockRejectedValue(
        Object.assign(new Error('wrapped'), { cause: { code: '23505' } }),
      );
      repo.getClassByField.mockResolvedValue(null);

      await expect(
        service.createClassService({ userId: TUTOR_ID, data: createDto }),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.CLASS_CODE_EXISTS));
    });

    it('rethrows non-unique database errors untouched', async () => {
      repo.create.mockRejectedValue(new Error('connection lost'));

      await expect(
        service.createClassService({ userId: TUTOR_ID, data: createDto }),
      ).rejects.toThrow('connection lost');
    });

    it('rejects an empty userId before any lookup', async () => {
      await expect(service.createClassService({ userId: '', data: createDto })).rejects.toThrow(
        new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID),
      );
      expect(user.userExists).not.toHaveBeenCalled();
    });

    it('rejects a non-UUID tutorId', async () => {
      await expect(
        service.createClassService({
          userId: TUTOR_ID,
          data: { ...createDto, tutorId: 'x' },
        }),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.TUTOR_ID_MUST_BE_UUID));
    });
  });

  describe('ADMIN ownership bypass', () => {
    const OWNED = { id: CLASS_ID, tutorId: OTHER_TUTOR_ID, name: 'Old', code: 'C0' };

    it('lets ADMIN update a class owned by another tutor', async () => {
      repo.getClassByField.mockResolvedValue(OWNED);
      repo.update.mockResolvedValue({ ...OWNED, subject: 'Math' });

      await expect(
        service.updateClassService({
          userId: TUTOR_ID,
          role: 'ADMIN',
          id: CLASS_ID,
          data: { subject: 'Math' } as never,
        }),
      ).resolves.toMatchObject({ subject: 'Math' });
    });

    it("still hides another tutor's class from a plain TUTOR on delete", async () => {
      repo.getClassByField.mockResolvedValue(OWNED);

      await expect(
        service.delClassService({ userId: TUTOR_ID, role: 'TUTOR', id: CLASS_ID }),
      ).rejects.toThrow(new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND));
      expect(repo.delClass).not.toHaveBeenCalled();
    });

    it('lets ADMIN resolve the owner gate for schedules/sessions of any class', async () => {
      repo.getClassByField.mockResolvedValue(OWNED);

      await expect(
        service.getOwnedClassService({ userId: TUTOR_ID, role: 'ADMIN', id: CLASS_ID }),
      ).resolves.toEqual(OWNED);
    });
  });

  describe('updateClassService', () => {
    const existing = { id: CLASS_ID, tutorId: TUTOR_ID, name: 'Old', code: 'C0' };

    it('returns NotFound when the class belongs to someone else', async () => {
      repo.getClassByField.mockResolvedValue({ ...existing, tutorId: OTHER_TUTOR_ID });

      await expect(
        service.updateClassService({ userId: TUTOR_ID, id: CLASS_ID, data: {} as never }),
      ).rejects.toThrow(new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND));
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('rejects renaming to a name owned by a different class', async () => {
      repo.getClassByField.mockImplementation(async ({ field }: { field: string }) =>
        field === 'id' ? existing : { id: 'other-class' },
      );

      await expect(
        service.updateClassService({
          userId: TUTOR_ID,
          id: CLASS_ID,
          data: { name: 'Taken' } as never,
        }),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.CLASS_NAME_EXISTS));
    });

    it('rejects changing the code to one owned by a different class', async () => {
      repo.getClassByField.mockImplementation(async ({ field }: { field: string }) =>
        field === 'id' ? existing : { id: 'other-class' },
      );

      await expect(
        service.updateClassService({
          userId: TUTOR_ID,
          id: CLASS_ID,
          data: { code: 'TAKEN' } as never,
        }),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.CLASS_CODE_EXISTS));
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('allows keeping the same code without a lookup that clashes with itself', async () => {
      repo.getClassByField.mockResolvedValue(existing);
      repo.update.mockResolvedValue(existing);

      await service.updateClassService({
        userId: TUTOR_ID,
        id: CLASS_ID,
        data: { code: 'C0' } as never,
      });

      const codeLookups = repo.getClassByField.mock.calls.filter(
        ([arg]: [{ field: string }]) => arg.field === 'code',
      );
      expect(codeLookups).toHaveLength(0);
    });

    it('allows keeping the same name (no lookup clash with itself)', async () => {
      repo.getClassByField.mockResolvedValue(existing);
      repo.update.mockResolvedValue({ ...existing, name: 'Old' });

      await expect(
        service.updateClassService({
          userId: TUTOR_ID,
          id: CLASS_ID,
          data: { name: 'Old' } as never,
        }),
      ).resolves.toMatchObject({ name: 'Old' });
    });

    it('validates student roles, dedupes ids, and syncs the roster before updating', async () => {
      repo.getClassByField.mockResolvedValue(existing);
      repo.update.mockResolvedValue({ ...existing });

      await service.updateClassService({
        userId: TUTOR_ID,
        id: CLASS_ID,
        data: { studentIds: [STUDENT_A, STUDENT_A, STUDENT_B], name: 'Old' } as never,
      });

      expect(user.getUserRolesByIds).toHaveBeenCalledWith([STUDENT_A, STUDENT_B]);
      expect(repo.syncStudents).toHaveBeenCalledWith({
        classId: CLASS_ID,
        studentIds: [STUDENT_A, STUDENT_B],
      });
      expect(repo.update).toHaveBeenCalledWith({ id: CLASS_ID, data: { name: 'Old' } });
    });

    it('refuses a student list containing a non-student and does not sync', async () => {
      repo.getClassByField.mockResolvedValue(existing);
      user.getUserRolesByIds.mockResolvedValue([
        { id: STUDENT_A, role: 'STUDENT' },
        { id: STUDENT_B, role: 'TUTOR' },
      ]);

      await expect(
        service.updateClassService({
          userId: TUTOR_ID,
          id: CLASS_ID,
          data: { studentIds: [STUDENT_A, STUDENT_B] } as never,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.syncStudents).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('refuses an unknown student id', async () => {
      repo.getClassByField.mockResolvedValue(existing);
      user.getUserRolesByIds.mockResolvedValue([]);

      await expect(
        service.updateClassService({
          userId: TUTOR_ID,
          id: CLASS_ID,
          data: { studentIds: [STUDENT_A] } as never,
        }),
      ).rejects.toThrow(
        new BadRequestException(`${ERROR_MESSAGES.STUDENT_NOT_FOUND}: ${STUDENT_A}`),
      );
    });

    it('falls back to the existing row when the repository returns nothing', async () => {
      repo.getClassByField.mockResolvedValue(existing);
      repo.update.mockResolvedValue(undefined);

      await expect(
        service.updateClassService({ userId: TUTOR_ID, id: CLASS_ID, data: {} as never }),
      ).resolves.toEqual(existing);
    });
  });

  describe('getClassesService', () => {
    it('scopes the list by the acting user role', async () => {
      repo.getClasses.mockResolvedValue({ classes: [], pagination: {} });

      await service.getClassesService({ userId: TUTOR_ID, query: { page: 1 } as never });

      expect(repo.getClasses).toHaveBeenCalledWith({
        userId: TUTOR_ID,
        role: 'TUTOR',
        query: { page: 1 },
      });
    });

    it('returns NotFound for an unknown acting user', async () => {
      user.getUserRoleById.mockResolvedValue(null);

      await expect(
        service.getClassesService({ userId: TUTOR_ID, query: {} as never }),
      ).rejects.toThrow(new NotFoundException(ERROR_MESSAGES.USER_NOT_EXIST));
      expect(repo.getClasses).not.toHaveBeenCalled();
    });
  });

  describe('getOwnedClassService (child-resource gate)', () => {
    it('returns the class when the user is its tutor', async () => {
      repo.getClassByField.mockResolvedValue({ id: CLASS_ID, tutorId: TUTOR_ID });

      await expect(
        service.getOwnedClassService({ userId: TUTOR_ID, id: CLASS_ID }),
      ).resolves.toEqual({ id: CLASS_ID, tutorId: TUTOR_ID });
    });

    it('returns NotFound (never Forbidden) for a class owned by someone else', async () => {
      repo.getClassByField.mockResolvedValue({ id: CLASS_ID, tutorId: OTHER_TUTOR_ID });

      await expect(
        service.getOwnedClassService({ userId: TUTOR_ID, id: CLASS_ID }),
      ).rejects.toThrow(new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND));
    });

    it('returns NotFound for a missing class', async () => {
      await expect(
        service.getOwnedClassService({ userId: TUTOR_ID, id: CLASS_ID }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a non-UUID class id', async () => {
      await expect(service.getOwnedClassService({ userId: TUTOR_ID, id: 'x' })).rejects.toThrow(
        new BadRequestException(ERROR_MESSAGES.CLASS_ID_MUST_BE_UUID),
      );
      expect(repo.getClassByField).not.toHaveBeenCalled();
    });
  });

  describe('getClassService (detail read)', () => {
    const cls = { id: CLASS_ID, tutorId: OTHER_TUTOR_ID };

    it('allows the class tutor', async () => {
      repo.getClass.mockResolvedValue({ ...cls, tutorId: TUTOR_ID });

      await expect(
        service.getClassService({ userId: TUTOR_ID, id: CLASS_ID }),
      ).resolves.toMatchObject({ tutorId: TUTOR_ID });
    });

    it('allows an enrolled student and strips classmates contact details', async () => {
      const withRoster = {
        ...cls,
        students: [{ id: STUDENT_B, firstName: 'B', email: 'b@x.io', phone: '0900' }],
      };
      repo.getClass.mockResolvedValue(withRoster);
      repo.isEnrolled.mockResolvedValue(true);

      await expect(service.getClassService({ userId: STUDENT_A, id: CLASS_ID })).resolves.toEqual({
        ...cls,
        students: [{ id: STUDENT_B, firstName: 'B' }],
      });
    });

    it('allows a parent of an enrolled student and strips classmates contact details', async () => {
      const withRoster = {
        ...cls,
        students: [{ id: STUDENT_B, firstName: 'B', email: 'b@x.io', phone: '0900' }],
      };
      repo.getClass.mockResolvedValue(withRoster);
      repo.isParentOfEnrolled.mockResolvedValue(true);

      await expect(service.getClassService({ userId: STUDENT_A, id: CLASS_ID })).resolves.toEqual({
        ...cls,
        students: [{ id: STUDENT_B, firstName: 'B' }],
      });
    });

    it('returns contact details to the class tutor', async () => {
      const withRoster = {
        ...cls,
        tutorId: TUTOR_ID,
        students: [{ id: STUDENT_B, firstName: 'B', email: 'b@x.io', phone: '0900' }],
      };
      repo.getClass.mockResolvedValue(withRoster);

      await expect(service.getClassService({ userId: TUTOR_ID, id: CLASS_ID })).resolves.toEqual(
        withRoster,
      );
    });

    it('hides the class from unrelated users as NotFound', async () => {
      repo.getClass.mockResolvedValue(cls);

      await expect(service.getClassService({ userId: STUDENT_A, id: CLASS_ID })).rejects.toThrow(
        new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND),
      );
    });
  });

  describe('delClassService', () => {
    it('deletes the class for its tutor and returns the id', async () => {
      repo.getClassByField.mockResolvedValue({ id: CLASS_ID, tutorId: TUTOR_ID });
      repo.delClass.mockResolvedValue(true);

      await expect(service.delClassService({ userId: TUTOR_ID, id: CLASS_ID })).resolves.toEqual({
        id: CLASS_ID,
      });
    });

    it('does not delete a class owned by someone else', async () => {
      repo.getClassByField.mockResolvedValue({ id: CLASS_ID, tutorId: OTHER_TUTOR_ID });

      await expect(service.delClassService({ userId: TUTOR_ID, id: CLASS_ID })).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.delClass).not.toHaveBeenCalled();
    });

    it('refuses to delete a class that still has tuition records', async () => {
      repo.getClassByField.mockResolvedValue({ id: CLASS_ID, tutorId: TUTOR_ID });
      repo.hasTuitionHistory.mockResolvedValue(true);

      await expect(service.delClassService({ userId: TUTOR_ID, id: CLASS_ID })).rejects.toThrow(
        new ConflictException(ERROR_MESSAGES.CLASS_HAS_TUITION_HISTORY),
      );
      expect(repo.delClass).not.toHaveBeenCalled();
    });

    it('throws NotFound when the delete affects no rows', async () => {
      repo.getClassByField.mockResolvedValue({ id: CLASS_ID, tutorId: TUTOR_ID });
      repo.delClass.mockResolvedValue(false);

      await expect(service.delClassService({ userId: TUTOR_ID, id: CLASS_ID })).rejects.toThrow(
        new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND),
      );
    });
  });
  describe('generateNewCodeService', () => {
    it('returns the first generated code when it is free', async () => {
      repo.getClassByField.mockResolvedValue(null);

      const code = await service.generateNewCodeService();

      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThan(0);
      expect(repo.getClassByField).toHaveBeenCalledTimes(1);
      expect(repo.getClassByField).toHaveBeenCalledWith({ field: 'code', value: code });
    });

    it('regenerates until it finds a code not used by any class', async () => {
      repo.getClassByField
        .mockResolvedValueOnce({ id: 'taken-1' })
        .mockResolvedValueOnce({ id: 'taken-2' })
        .mockResolvedValueOnce(null);

      const code = await service.generateNewCodeService();

      expect(repo.getClassByField).toHaveBeenCalledTimes(3);
      expect(repo.getClassByField).toHaveBeenLastCalledWith({ field: 'code', value: code });
    });

    it('throws Conflict after five colliding attempts instead of looping forever', async () => {
      repo.getClassByField.mockResolvedValue({ id: 'taken' });

      const error = await service.generateNewCodeService().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe(
        ERROR_MESSAGES.UNABLE_TO_GENERATE_UNIQUE_CODE,
      );
      expect(repo.getClassByField).toHaveBeenCalledTimes(5);
    });
  });

  describe('addStudentsService', () => {
    const input = (studentIds: string[]) =>
      ({ userId: TUTOR_ID, classId: CLASS_ID, data: { studentIds } }) as never;

    it('rejects a non-UUID acting user before any lookup', async () => {
      await expect(
        service.addStudentsService({
          userId: 'nope',
          classId: CLASS_ID,
          data: { studentIds: [] },
        } as never),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID));
      expect(repo.getClassByField).not.toHaveBeenCalled();
    });

    it('rejects a non-UUID class id before any lookup', async () => {
      await expect(
        service.addStudentsService({
          userId: TUTOR_ID,
          classId: 'nope',
          data: { studentIds: [] },
        } as never),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.CLASS_ID_MUST_BE_UUID));
      expect(repo.getClassByField).not.toHaveBeenCalled();
    });

    it('throws NotFound when the class does not exist', async () => {
      repo.getClassByField.mockResolvedValue(null);

      await expect(service.addStudentsService(input([STUDENT_A]))).rejects.toThrow(
        new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND),
      );
      expect(repo.addStudents).not.toHaveBeenCalled();
    });

    it('throws NotFound when the class is owned by another tutor', async () => {
      repo.getClassByField.mockResolvedValue({ id: CLASS_ID, tutorId: OTHER_TUTOR_ID });

      await expect(service.addStudentsService(input([STUDENT_A]))).rejects.toThrow(
        new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND),
      );
      expect(repo.addStudents).not.toHaveBeenCalled();
    });

    it('dedupes the requested ids before validating and inserting them', async () => {
      repo.getClassByField.mockResolvedValue({ id: CLASS_ID, tutorId: TUTOR_ID });
      repo.addStudents.mockResolvedValue([{ studentId: STUDENT_A }, { studentId: STUDENT_B }]);

      const result = await service.addStudentsService(input([STUDENT_A, STUDENT_B, STUDENT_A]));

      expect(user.getUserRolesByIds).toHaveBeenCalledWith([STUDENT_A, STUDENT_B]);
      expect(repo.addStudents).toHaveBeenCalledWith({
        classId: CLASS_ID,
        studentIds: [STUDENT_A, STUDENT_B],
      });
      expect(result).toEqual({
        classId: CLASS_ID,
        added: 2,
        skipped: 0,
        studentIds: [STUDENT_A, STUDENT_B],
      });
    });

    it('reports already-enrolled students as skipped, not added', async () => {
      repo.getClassByField.mockResolvedValue({ id: CLASS_ID, tutorId: TUTOR_ID });
      repo.addStudents.mockResolvedValue([{ studentId: STUDENT_B }]);

      const result = await service.addStudentsService(input([STUDENT_A, STUDENT_B]));

      expect(result).toEqual({
        classId: CLASS_ID,
        added: 1,
        skipped: 1,
        studentIds: [STUDENT_B],
      });
    });

    it('does not insert anything when a listed id is not a student', async () => {
      repo.getClassByField.mockResolvedValue({ id: CLASS_ID, tutorId: TUTOR_ID });
      user.getUserRolesByIds.mockResolvedValue([
        { id: STUDENT_A, role: 'STUDENT' },
        { id: STUDENT_B, role: 'TUTOR' },
      ]);

      await expect(service.addStudentsService(input([STUDENT_A, STUDENT_B]))).rejects.toThrow();
      expect(repo.addStudents).not.toHaveBeenCalled();
    });
  });

  describe('access-gated reads (loadAccessibleClass)', () => {
    const cls = {
      id: CLASS_ID,
      tutorId: OTHER_TUTOR_ID,
      name: 'Math',
      subject: 'MATH',
      curriculumId: null,
    };

    it('rejects a non-UUID acting user before any lookup', async () => {
      await expect(service.getAllStudentsService({ userId: 'nope', id: CLASS_ID })).rejects.toThrow(
        new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID),
      );
      expect(repo.getClassByField).not.toHaveBeenCalled();
    });

    it('rejects a non-UUID class id before any lookup', async () => {
      await expect(service.getAllStudentsService({ userId: TUTOR_ID, id: 'nope' })).rejects.toThrow(
        new BadRequestException(ERROR_MESSAGES.CLASS_ID_MUST_BE_UUID),
      );
      expect(repo.getClassByField).not.toHaveBeenCalled();
    });

    it('returns NotFound for a missing class', async () => {
      repo.getClassByField.mockResolvedValue(null);

      await expect(
        service.getAllStudentsService({ userId: TUTOR_ID, id: CLASS_ID }),
      ).rejects.toThrow(new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND));
    });

    it('grants the owner access without consulting enrollment', async () => {
      repo.getClassByField.mockResolvedValue({ ...cls, tutorId: TUTOR_ID });
      repo.getAllStudent.mockResolvedValue([{ id: STUDENT_A }]);

      await expect(
        service.getAllStudentsService({ userId: TUTOR_ID, id: CLASS_ID }),
      ).resolves.toEqual([{ id: STUDENT_A }]);
      expect(repo.isEnrolled).not.toHaveBeenCalled();
      expect(repo.isParentOfEnrolled).not.toHaveBeenCalled();
    });

    it('grants an enrolled student access', async () => {
      repo.getClassByField.mockResolvedValue(cls);
      repo.isEnrolled.mockResolvedValue(true);
      repo.getAllStudent.mockResolvedValue([]);

      await expect(
        service.getAllStudentsService({ userId: STUDENT_A, id: CLASS_ID }),
      ).resolves.toEqual([]);
    });

    // regression (TUT3-04): non-owners get the roster without email/phone or parent contact
    it('hides student and parent contact details from a non-owner', async () => {
      repo.getClassByField.mockResolvedValue(cls);
      repo.isEnrolled.mockResolvedValue(true);
      repo.getAllStudent.mockResolvedValue([
        {
          id: STUDENT_B,
          firstName: 'B',
          email: 'b@x.io',
          phone: '0900',
          parent: {
            id: 'p1',
            firstName: 'P',
            lastName: 'Q',
            email: 'p@x.io',
            phone: '0911',
            avatar: null,
            relationship: 'MOTHER',
          },
        },
      ]);

      const roster = await service.getAllStudentsService({ userId: STUDENT_A, id: CLASS_ID });

      expect(roster).toEqual([
        {
          id: STUDENT_B,
          firstName: 'B',
          parent: { id: 'p1', firstName: 'P', lastName: 'Q', avatar: null },
        },
      ]);
    });

    it('grants a parent of an enrolled student access', async () => {
      repo.getClassByField.mockResolvedValue(cls);
      repo.isParentOfEnrolled.mockResolvedValue(true);
      repo.getAllStudent.mockResolvedValue([]);

      await expect(
        service.getAllStudentsService({ userId: STUDENT_B, id: CLASS_ID }),
      ).resolves.toEqual([]);
    });

    it('hides the roster from unrelated users as NotFound', async () => {
      repo.getClassByField.mockResolvedValue(cls);

      await expect(
        service.getAllStudentsService({ userId: STUDENT_B, id: CLASS_ID }),
      ).rejects.toThrow(new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND));
      expect(repo.getAllStudent).not.toHaveBeenCalled();
    });
  });

  describe('getClassMaterialsService', () => {
    const cls = {
      id: CLASS_ID,
      tutorId: TUTOR_ID,
      name: 'Math',
      subject: 'MATH',
      curriculumId: 'cur-1',
    };

    it('returns an empty material list when the class has no curriculum', async () => {
      repo.getClassByField.mockResolvedValue({ ...cls, curriculumId: null });

      await expect(
        service.getClassMaterialsService({ userId: TUTOR_ID, id: CLASS_ID }),
      ).resolves.toEqual({
        class: { id: CLASS_ID, name: 'Math', subject: 'MATH', curriculumId: null },
        lessons: [],
        theoryCount: 0,
        exerciseCount: 0,
      });
      expect(repo.getMaterials).not.toHaveBeenCalled();
    });

    it('counts theory and exercise urls across lessons, tolerating missing lists', async () => {
      repo.getClassByField.mockResolvedValue(cls);
      repo.getMaterials.mockResolvedValue([
        { id: 'l1', theoryUrls: ['a', 'b'], exerciseUrls: ['x'] },
        { id: 'l2', theoryUrls: ['c'] },
        { id: 'l3', theoryUrls: null, exerciseUrls: undefined },
      ]);

      const result = await service.getClassMaterialsService({ userId: TUTOR_ID, id: CLASS_ID });

      expect(repo.getMaterials).toHaveBeenCalledWith({ curriculumId: 'cur-1' });
      expect(result.theoryCount).toBe(3);
      expect(result.exerciseCount).toBe(1);
      expect(result.lessons).toHaveLength(3);
    });

    it('is reachable by an enrolled student', async () => {
      repo.getClassByField.mockResolvedValue(cls);
      repo.isEnrolled.mockResolvedValue(true);
      repo.getMaterials.mockResolvedValue([]);

      await expect(
        service.getClassMaterialsService({ userId: STUDENT_A, id: CLASS_ID }),
      ).resolves.toMatchObject({
        theoryCount: 0,
      });
    });

    it('is hidden from unrelated users as NotFound', async () => {
      repo.getClassByField.mockResolvedValue(cls);

      await expect(
        service.getClassMaterialsService({ userId: STUDENT_B, id: CLASS_ID }),
      ).rejects.toThrow(new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND));
      expect(repo.getMaterials).not.toHaveBeenCalled();
    });
  });

  describe('getClassWatchService', () => {
    const cls = { id: CLASS_ID, tutorId: OTHER_TUTOR_ID, name: 'Math' };
    const session = (status: string) => ({
      id: 's1',
      status,
      exerciseUrls: ['https://files/ex.pdf'],
    });

    beforeEach(() => {
      repo.getClassByField.mockResolvedValue(cls);
      repo.isEnrolled.mockResolvedValue(true);
      repo.getAllStudent.mockResolvedValue([{ id: STUDENT_A, email: 'a@x.io', phone: null }]);
      repo.getSchedulesByClass.mockResolvedValue([{ id: 'sch-1' }]);
    });

    it('returns class, roster, schedules and a null session when none has been held', async () => {
      repo.getRecentSessionByClass.mockResolvedValue(undefined);

      await expect(
        service.getClassWatchService({ userId: STUDENT_A, id: CLASS_ID }),
      ).resolves.toEqual({
        class: cls,
        recentSession: null,
        schedules: [{ id: 'sch-1' }],
        students: [{ id: STUDENT_A, parent: null }],
      });
    });

    it('hides exercise urls from a non-owner while the recent session is still running', async () => {
      repo.getRecentSessionByClass.mockResolvedValue(session('IN_PROGRESS'));

      const result = await service.getClassWatchService({ userId: STUDENT_A, id: CLASS_ID });

      expect(result.recentSession).toEqual({ id: 's1', status: 'IN_PROGRESS', exerciseUrls: [] });
    });

    it('shows exercise urls to a non-owner once the session is completed', async () => {
      repo.getRecentSessionByClass.mockResolvedValue(session('COMPLETED'));

      const result = await service.getClassWatchService({ userId: STUDENT_A, id: CLASS_ID });

      expect(result.recentSession?.exerciseUrls).toEqual(['https://files/ex.pdf']);
    });

    it('never hides exercise urls from the class tutor', async () => {
      repo.getClassByField.mockResolvedValue({ ...cls, tutorId: TUTOR_ID });
      repo.getRecentSessionByClass.mockResolvedValue(session('IN_PROGRESS'));

      const result = await service.getClassWatchService({ userId: TUTOR_ID, id: CLASS_ID });

      expect(result.recentSession?.exerciseUrls).toEqual(['https://files/ex.pdf']);
    });

    it('is hidden from unrelated users as NotFound', async () => {
      repo.isEnrolled.mockResolvedValue(false);

      await expect(
        service.getClassWatchService({ userId: STUDENT_B, id: CLASS_ID }),
      ).rejects.toThrow(new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND));
      expect(repo.getAllStudent).not.toHaveBeenCalled();
    });
  });

  describe('remaining input and existence guards', () => {
    it('createClassService rejects an acting user that does not exist', async () => {
      user.getUserRoleById.mockResolvedValueOnce(null);

      await expect(
        service.createClassService({ userId: TUTOR_ID, data: createDto }),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.USER_NOT_FOUND));
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('updateClassService rejects an empty userId and a non-UUID class id', async () => {
      await expect(
        service.updateClassService({ userId: '', id: CLASS_ID, data: {} as never }),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID));
      await expect(
        service.updateClassService({ userId: TUTOR_ID, id: 'nope', data: {} as never }),
      ).rejects.toThrow(new BadRequestException(ERROR_MESSAGES.CLASS_ID_MUST_BE_UUID));
      expect(repo.getClassByField).not.toHaveBeenCalled();
    });

    it('getClassesService rejects an empty userId', async () => {
      await expect(service.getClassesService({ userId: '', query: {} as never })).rejects.toThrow(
        new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID),
      );
      expect(repo.getClasses).not.toHaveBeenCalled();
    });

    it('getClassesService passes no role filter when the acting user has a null role', async () => {
      user.getUserRoleById.mockResolvedValueOnce({ id: TUTOR_ID, role: null });
      repo.getClasses.mockResolvedValue({ classes: [], pagination: {} });

      await service.getClassesService({ userId: TUTOR_ID, query: {} as never });

      expect(repo.getClasses).toHaveBeenCalledWith(
        expect.objectContaining({ userId: TUTOR_ID, role: undefined }),
      );
    });

    it('getClassService rejects an empty userId or class id', async () => {
      await expect(service.getClassService({ userId: '', id: CLASS_ID })).rejects.toThrow(
        new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID),
      );
      await expect(service.getClassService({ userId: TUTOR_ID, id: '' })).rejects.toThrow(
        new BadRequestException(ERROR_MESSAGES.CLASS_ID_MUST_BE_UUID),
      );
      expect(repo.getClass).not.toHaveBeenCalled();
    });

    it('delClassService rejects an empty userId or class id', async () => {
      await expect(service.delClassService({ userId: '', id: CLASS_ID })).rejects.toThrow(
        new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID),
      );
      await expect(service.delClassService({ userId: TUTOR_ID, id: '' })).rejects.toThrow(
        new BadRequestException(ERROR_MESSAGES.CLASS_ID_MUST_BE_UUID),
      );
      expect(repo.delClass).not.toHaveBeenCalled();
    });

    it('delClassService returns NotFound when the acting user does not exist', async () => {
      user.userExists.mockResolvedValueOnce(false);

      await expect(service.delClassService({ userId: TUTOR_ID, id: CLASS_ID })).rejects.toThrow(
        new NotFoundException(ERROR_MESSAGES.USER_NOT_EXIST),
      );
      expect(repo.delClass).not.toHaveBeenCalled();
    });
  });

  describe('missing-record branches', () => {
    it('getClassService returns NotFound for a class that does not exist', async () => {
      repo.getClass.mockResolvedValue(null);

      await expect(service.getClassService({ userId: TUTOR_ID, id: CLASS_ID })).rejects.toThrow(
        new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND),
      );
      expect(repo.isEnrolled).not.toHaveBeenCalled();
    });

    it('delClassService returns NotFound when the class is missing', async () => {
      repo.getClassByField.mockResolvedValue(null);

      await expect(service.delClassService({ userId: TUTOR_ID, id: CLASS_ID })).rejects.toThrow(
        new NotFoundException(ERROR_MESSAGES.CLASS_NOT_FOUND),
      );
      expect(repo.delClass).not.toHaveBeenCalled();
    });
  });
});
