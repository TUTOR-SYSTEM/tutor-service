import { buildListWhereClause, buildPagination } from '@packages/helpers/queryList.helper';

const searchFields = ['firstName', 'lastName'];

describe('buildListWhereClause', () => {
  it('returns undefined when there is nothing to filter on', () => {
    expect(buildListWhereClause({})).toBeUndefined();
  });

  it('ignores a blank or whitespace-only search term', () => {
    expect(buildListWhereClause({ search: '   ', searchFields })).toBeUndefined();
  });

  it('matches the trimmed term case-insensitively across every search field (OR)', () => {
    expect(buildListWhereClause({ search: '  an  ', searchFields })).toEqual({
      OR: [
        { firstName: { contains: 'an', mode: 'insensitive' } },
        { lastName: { contains: 'an', mode: 'insensitive' } },
      ],
    });
  });

  it('ignores the search term when no search fields are configured', () => {
    expect(buildListWhereClause({ search: 'an', searchFields: [] })).toBeUndefined();
    expect(buildListWhereClause({ search: 'an' })).toBeUndefined();
  });

  it('applies exact-match filters and skips null/undefined values', () => {
    expect(
      buildListWhereClause({
        filters: { role: 'TUTOR', isActive: undefined, parentId: null },
      }),
    ).toEqual({ role: 'TUTOR' });
  });

  it('returns a single condition unwrapped when only one filter applies', () => {
    expect(buildListWhereClause({ filters: { role: 'ADMIN' } })).toEqual({ role: 'ADMIN' });
  });

  it('combines search and filters with AND', () => {
    expect(
      buildListWhereClause({ search: 'an', searchFields, filters: { role: 'STUDENT' } }),
    ).toEqual({
      AND: [
        {
          OR: [
            { firstName: { contains: 'an', mode: 'insensitive' } },
            { lastName: { contains: 'an', mode: 'insensitive' } },
          ],
        },
        { role: 'STUDENT' },
      ],
    });
  });
});

describe('buildPagination', () => {
  it('computes totalPages by rounding up', () => {
    expect(buildPagination(21, 2, 10)).toEqual({ total: 21, page: 2, limit: 10, totalPages: 3 });
  });

  it('reports zero pages for an empty result', () => {
    expect(buildPagination(0, 1, 10).totalPages).toBe(0);
  });
});
