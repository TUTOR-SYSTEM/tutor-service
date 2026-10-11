import { Test, TestingModule } from '@nestjs/testing';
import { eq, inArray } from 'drizzle-orm';
import { DRIZZLE } from 'src/database/database.module';
import { users } from 'src/database/schema';
import { UserService } from 'src/features/user/user.service';

jest.mock('drizzle-orm', () => {
  const actual = jest.requireActual('drizzle-orm');
  return {
    ...actual,
    eq: jest.fn((column: unknown, value: unknown) => ({ op: 'eq', column, value })),
    inArray: jest.fn((column: unknown, values: unknown) => ({ op: 'inArray', column, values })),
  };
});

const USER_ID = '11111111-1111-4111-8111-111111111111';

// Chainable, awaitable stand-in for a drizzle select: every builder method returns the chain and
// awaiting it resolves to the scripted rows.
const chain = (rows: unknown) => {
  const c: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'limit']) c[m] = jest.fn(() => c);
  c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve, reject);
  return c;
};

describe('UserService', () => {
  let service: UserService;
  let db: { select: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    db = { select: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [UserService, { provide: DRIZZLE, useValue: db }],
    }).compile();

    service = module.get(UserService);
  });

  describe('getUserByField', () => {
    it.each([
      ['id', 'id'],
      ['email', 'email'],
      ['username', 'username'],
      ['phone', 'phone'],
      ['userCode', 'userCode'],
    ] as const)('filters by %s using the matching column', async (field) => {
      const row = { id: USER_ID };
      const from = jest.fn();
      const where = jest.fn().mockResolvedValue([row]);
      db.select.mockReturnValue({ from: from.mockReturnValue({ where }) });

      const result = await service.getUserByField({ field, value: 'the-value' });

      expect(from).toHaveBeenCalledWith(users);
      expect(eq).toHaveBeenCalledWith(users[field], 'the-value');
      expect(where).toHaveBeenCalledWith({ op: 'eq', column: users[field], value: 'the-value' });
      expect(result).toEqual([row]);
    });

    it('returns an empty list without querying when the field is not whitelisted', async () => {
      const result = await service.getUserByField({
        field: 'password' as never,
        value: 'x',
      });

      expect(result).toEqual([]);
      expect(db.select).not.toHaveBeenCalled();
    });

    it('returns an empty list when no row matches', async () => {
      db.select.mockReturnValue({ from: () => ({ where: () => Promise.resolve([]) }) });

      await expect(
        service.getUserByField({ field: 'email', value: 'none@x.dev' }),
      ).resolves.toEqual([]);
    });

    it('propagates database errors to the caller', async () => {
      db.select.mockReturnValue({
        from: () => ({ where: () => Promise.reject(new Error('connection lost')) }),
      });

      await expect(service.getUserByField({ field: 'id', value: USER_ID })).rejects.toThrow(
        'connection lost',
      );
    });
  });

  describe('userExists', () => {
    it('selects only the id and limits to one row', async () => {
      const select = chain([{ id: USER_ID }]);
      db.select.mockReturnValue(select);

      await service.userExists(USER_ID);

      expect(db.select).toHaveBeenCalledWith({ id: users.id });
      expect(select.limit).toHaveBeenCalledWith(1);
      expect(eq).toHaveBeenCalledWith(users.id, USER_ID);
    });

    it('returns true when a row is found', async () => {
      db.select.mockReturnValue(chain([{ id: USER_ID }]));

      await expect(service.userExists(USER_ID)).resolves.toBe(true);
    });

    it('returns false when no row is found', async () => {
      db.select.mockReturnValue(chain([]));

      await expect(service.userExists(USER_ID)).resolves.toBe(false);
    });
  });

  describe('getUserRoleById', () => {
    it('selects id and role for the given user', async () => {
      const select = chain([{ id: USER_ID, role: 'TUTOR' }]);
      db.select.mockReturnValue(select);

      const result = await service.getUserRoleById(USER_ID);

      expect(db.select).toHaveBeenCalledWith({ id: users.id, role: users.role });
      expect(select.limit).toHaveBeenCalledWith(1);
      expect(result).toEqual({ id: USER_ID, role: 'TUTOR' });
    });

    it('returns null when the user does not exist', async () => {
      db.select.mockReturnValue(chain([]));

      await expect(service.getUserRoleById(USER_ID)).resolves.toBeNull();
    });
  });

  describe('getUserRolesByIds', () => {
    it('returns an empty list without querying when no ids are given', async () => {
      await expect(service.getUserRolesByIds([])).resolves.toEqual([]);
      expect(db.select).not.toHaveBeenCalled();
    });

    it('looks up every requested id in one query', async () => {
      const rows = [
        { id: 'a', role: 'STUDENT' },
        { id: 'b', role: 'PARENT' },
      ];
      const where = jest.fn().mockResolvedValue(rows);
      db.select.mockReturnValue({ from: () => ({ where }) });

      const result = await service.getUserRolesByIds(['a', 'b']);

      expect(db.select).toHaveBeenCalledTimes(1);
      expect(inArray).toHaveBeenCalledWith(users.id, ['a', 'b']);
      expect(result).toEqual(rows);
    });
  });
});
