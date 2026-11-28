import { ForbiddenException } from '@nestjs/common';
import { ApiRoutesService } from 'src/features/api-routes/api-routes.service';
import { buildCatalog } from 'src/features/api-routes/api-routes.repository';

// regression (TS-03): saveResult/catalog restricted to ADMIN/TUTOR (fail closed), bounded doc,
// catalog hides file/line from other roles.
jest.mock('src/features/api-routes/api-routes.repository', () => ({
  ApiRoutesRepository: class {},
  buildCatalog: jest.fn(),
}));

describe('ApiRoutesService (TS-03)', () => {
  const repo = {
    upsertResult: jest.fn().mockResolvedValue({ routeId: 'r' }),
    listResults: jest.fn(),
  };
  const service = new ApiRoutesService(repo as never, {} as never);
  const save = (role: unknown, doc: unknown = { note: 'x' }) =>
    (service.saveResult as (p: unknown) => unknown)({
      userId: 'u1',
      role,
      routeId: 'r1',
      data: { status: 'pass', doc },
    });

  beforeEach(() => jest.clearAllMocks());

  it.each(['STUDENT', 'PARENT', undefined, '', 'admin '])(
    'saveResult rejects role %p and never writes',
    async (role) => {
      await expect(Promise.resolve().then(() => save(role))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(repo.upsertResult).not.toHaveBeenCalled();
    },
  );

  it.each(['ADMIN', 'TUTOR'])('saveResult allows %s', async (role) => {
    await save(role);
    expect(repo.upsertResult).toHaveBeenCalledTimes(1);
  });

  it('saveResult rejects an oversized doc even for ADMIN', async () => {
    const big = { blob: 'x'.repeat(2 * 1024 * 1024) };
    await expect(Promise.resolve().then(() => save('ADMIN', big))).rejects.toBeDefined();
    expect(repo.upsertResult).not.toHaveBeenCalled();
  });

  describe('getCatalog', () => {
    const catalog = { items: [{ id: 1, path: '/a', file: 'src/a.ts', line: 10 }] };
    beforeEach(() => (buildCatalog as jest.Mock).mockResolvedValue(structuredClone(catalog)));
    const get = (role: unknown) => (service.getCatalog as (p: unknown) => Promise<any>)({ role });

    it.each(['STUDENT', undefined])('strips file/line for role %p', async (role) => {
      const res = await get(role);
      expect(res.items[0]).not.toHaveProperty('file');
      expect(res.items[0]).not.toHaveProperty('line');
    });

    it.each(['ADMIN', 'TUTOR'])('keeps file/line for %s', async (role) => {
      const res = await get(role);
      expect(res.items[0]).toMatchObject({ file: 'src/a.ts', line: 10 });
    });
  });
});
