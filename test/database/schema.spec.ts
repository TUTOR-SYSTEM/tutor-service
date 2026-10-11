import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import * as schema from 'src/database/schema';

// Index definitions and `$onUpdate` hooks are only evaluated when a table is introspected or a
// row is updated, so this spec walks every table to execute them.
const tables = Object.values(schema).filter((value): value is PgTable => is(value, PgTable));

describe('database schema', () => {
  it('exposes the expected tables', () => {
    expect(tables.length).toBeGreaterThan(0);
  });

  it.each(tables.map((table) => [getTableConfig(table).name, table]))(
    'builds the indexes and unique constraints for %s',
    (_name, table) => {
      const config = getTableConfig(table as PgTable);

      for (const index of config.indexes) {
        expect(index.config.name).toEqual(expect.any(String));
      }
      for (const unique of config.uniqueConstraints) {
        expect(unique.name).toEqual(expect.any(String));
      }
    },
  );

  it.each(tables.map((table) => [getTableConfig(table).name, table]))(
    'resolves the foreign key references of %s',
    (_name, table) => {
      const config = getTableConfig(table as PgTable);

      for (const foreignKey of config.foreignKeys) {
        const { columns, foreignColumns } = foreignKey.reference();
        expect(columns.length).toBeGreaterThan(0);
        expect(foreignColumns.length).toBe(columns.length);
      }
    },
  );

  it('refreshes updatedAt through $onUpdate for every timestamp column that declares it', () => {
    const hooked = tables.flatMap((table) =>
      Object.values(getTableConfig(table).columns).filter(
        (column) => typeof (column as { onUpdateFn?: unknown }).onUpdateFn === 'function',
      ),
    );

    expect(hooked.length).toBeGreaterThan(0);
    for (const column of hooked) {
      const value = (column as unknown as { onUpdateFn: () => unknown }).onUpdateFn();
      expect(value).toBeInstanceOf(Date);
    }
  });
});
