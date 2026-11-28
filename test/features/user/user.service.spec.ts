import { UserService } from 'src/features/user/user.service';
import { createPrismaMock, PrismaMock } from '../../support/prisma.mock';

const USER_ID = '11111111-1111-4111-8111-111111111111';

describe('UserService', () => {
  let service: UserService;
  let prisma: PrismaMock;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new UserService(prisma as never);
  });

  describe('getUserByField', () => {
    it('looks a user up by id and selects only the non-secret columns', async () => {
      const row = {
        id: USER_ID,
        firstName: 'An',
        lastName: 'Nguyen',
        role: 'STUDENT',
        tutorId: null,
      };
      prisma.user.findMany.mockResolvedValue([row]);

      const result = await service.getUserByField({ field: 'id', value: USER_ID });

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { id: USER_ID },
        select: { id: true, firstName: true, lastName: true, role: true, tutorId: true },
      });
      expect(result).toEqual([row]);
    });

    it('never selects the password column', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await service.getUserByField({ field: 'id', value: USER_ID });

      const args = prisma.user.findMany.mock.calls[0][0] as { select: Record<string, boolean> };
      expect(args.select).toBeDefined();
      expect(args.select).not.toHaveProperty('password');
    });

    it.each(['email', 'username', 'phone', 'userCode'])(
      'refuses to look up by %s (not needed by any caller, and enumerable)',
      async (field) => {
        const result = await service.getUserByField({ field: field as never, value: 'x' });

        expect(result).toEqual([]);
        expect(prisma.user.findMany).not.toHaveBeenCalled();
      },
    );

    it('returns an empty list without querying when the field is not whitelisted', async () => {
      const result = await service.getUserByField({
        field: 'password' as never,
        value: 'x',
      });

      expect(result).toEqual([]);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('returns an empty list when no row matches', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await expect(service.getUserByField({ field: 'id', value: USER_ID })).resolves.toEqual([]);
    });

    it('propagates database errors to the caller', async () => {
      prisma.user.findMany.mockRejectedValue(new Error('connection lost'));

      await expect(service.getUserByField({ field: 'id', value: USER_ID })).rejects.toThrow(
        'connection lost',
      );
    });
  });

  describe('userExists', () => {
    it('selects only the id of the given user', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: USER_ID });

      await service.userExists(USER_ID);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: USER_ID },
        select: { id: true },
      });
    });

    it('returns true when a row is found', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: USER_ID });

      await expect(service.userExists(USER_ID)).resolves.toBe(true);
    });

    it('returns false when no row is found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.userExists(USER_ID)).resolves.toBe(false);
    });
  });

  describe('getUserRoleById', () => {
    it('selects id and role for the given user', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: USER_ID, role: 'TUTOR' });

      const result = await service.getUserRoleById(USER_ID);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: USER_ID },
        select: { id: true, role: true },
      });
      expect(result).toEqual({ id: USER_ID, role: 'TUTOR' });
    });

    it('returns null when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getUserRoleById(USER_ID)).resolves.toBeNull();
    });
  });

  describe('getUserRolesByIds', () => {
    it('returns an empty list without querying when no ids are given', async () => {
      await expect(service.getUserRolesByIds([])).resolves.toEqual([]);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('looks up every requested id in one query', async () => {
      const rows = [
        { id: 'a', role: 'STUDENT' },
        { id: 'b', role: 'PARENT' },
      ];
      prisma.user.findMany.mockResolvedValue(rows);

      const result = await service.getUserRolesByIds(['a', 'b']);

      expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['a', 'b'] } },
        select: { id: true, role: true, tutorId: true },
      });
      expect(result).toEqual(rows);
    });
  });
});
