import { PgDialect } from 'drizzle-orm/pg-core';
import { users } from 'src/database/schema';
import { buildListWhereClause } from '@packages/helpers/queryList.helper';

const dialect = new PgDialect();
const render = (clause: Parameters<PgDialect['sqlToQuery']>[0]) => dialect.sqlToQuery(clause);

const searchable = {
  name: { column: users.firstName },
  surname: { column: users.lastName },
};

describe('buildListWhereClause', () => {
  it('returns undefined when there is nothing to filter on', () => {
    expect(buildListWhereClause({})).toBeUndefined();
  });

  it('ignores a blank or whitespace-only search term', () => {
    expect(buildListWhereClause({ search: '   ', searchableColumns: searchable })).toBeUndefined();
  });

  it('matches the trimmed term with ILIKE across every searchable column (OR)', () => {
    const clause = buildListWhereClause({ search: '  an  ', searchableColumns: searchable });
    const query = render(clause!);

    expect(query.sql).toMatch(/ilike .* or .* ilike/i);
    expect(query.params).toEqual(['%an%', '%an%']);
  });

  it('adds no search condition when no searchable columns are configured', () => {
    expect(buildListWhereClause({ search: 'an', searchableColumns: {} })).toBeUndefined();
  });

  it('applies exact-match filters with eq and skips null/undefined values', () => {
    const clause = buildListWhereClause({
      filters: { role: 'TUTOR', isActive: undefined, parentId: null },
      filterColumns: {
        role: { column: users.role },
        isActive: { column: users.isActive },
        parentId: { column: users.parentId },
      },
    });
    const query = render(clause!);

    expect(query.sql).toMatch(/"role" = /);
    expect(query.sql).not.toMatch(/is_active/);
    expect(query.sql).not.toMatch(/parent_id/);
    expect(query.params).toEqual(['TUTOR']);
  });

  it('ignores filter keys that have no column mapping', () => {
    const clause = buildListWhereClause({
      filters: { unknown: 'x' },
      filterColumns: {},
    });

    expect(clause).toBeUndefined();
  });

  it('runs the transform on the value before comparing', () => {
    const clause = buildListWhereClause({
      filters: { role: 'tutor' },
      filterColumns: {
        role: { column: users.role, transform: (value) => String(value).toUpperCase() },
      },
    });

    expect(render(clause!).params).toEqual(['TUTOR']);
  });

  it('returns a single condition unwrapped when only one filter applies', () => {
    const clause = buildListWhereClause({
      filters: { role: 'ADMIN' },
      filterColumns: { role: { column: users.role } },
    });

    expect(render(clause!).sql).not.toMatch(/\band\b/i);
  });

  it('combines search and filters with AND', () => {
    const clause = buildListWhereClause({
      search: 'an',
      searchableColumns: searchable,
      filters: { role: 'STUDENT' },
      filterColumns: { role: { column: users.role } },
    });
    const query = render(clause!);

    expect(query.sql).toMatch(/\band\b/i);
    expect(query.params).toEqual(['%an%', '%an%', 'STUDENT']);
  });
});

describe('buildListWhereClause search with unmapped searchable entries', () => {
  it('skips searchable keys whose column entry is undefined', () => {
    const clause = buildListWhereClause({
      search: 'an',
      searchableColumns: { name: undefined, surname: { column: users.lastName } } as never,
    });
    const query = render(clause!);

    expect(query.sql).not.toMatch(/or/i);
    expect(query.params).toEqual(['%an%']);
  });

  it('returns undefined when every searchable entry is undefined', () => {
    expect(
      buildListWhereClause({
        search: 'an',
        searchableColumns: { name: undefined } as never,
      }),
    ).toBeUndefined();
  });

  describe('buildListWhereClause without searchable columns configured', () => {
    it('ignores the search term when searchableColumns is omitted entirely', () => {
      expect(buildListWhereClause({ search: 'an' })).toBeUndefined();
    });
  });
});
