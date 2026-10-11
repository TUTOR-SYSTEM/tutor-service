import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const CHAIN_METHODS = [
  'select',
  'insert',
  'update',
  'delete',
  'from',
  'values',
  'set',
  'where',
  'innerJoin',
  'leftJoin',
  'groupBy',
  'orderBy',
  'limit',
  'offset',
  'returning',
  'onConflictDoNothing',
  'onConflictDoUpdate',
] as const;

export type DrizzleMock = Record<(typeof CHAIN_METHODS)[number], jest.Mock> & {
  /** Queue the value the next awaited query resolves to (FIFO, one entry per `await`). */
  queue: (...results: unknown[]) => void;
};

/**
 * Chainable stand-in for the Drizzle `db` object. Every builder method returns the same
 * builder, and awaiting a builder pops the next queued result, so a repository method that
 * issues several queries gets them back in order.
 */
export function createDrizzleMock(): DrizzleMock {
  const pending: unknown[] = [];
  const db: Record<string, unknown> = {
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(pending.shift()).then(onFulfilled, onRejected),
  };
  for (const name of CHAIN_METHODS) {
    db[name] = jest.fn(() => db);
  }
  db.queue = (...results: unknown[]) => {
    pending.push(...results);
  };
  return db as DrizzleMock;
}

/**
 * The condition of the outermost query. Subqueries (e.g. "classes owned by the tutor") are built
 * before the outer `where`, so the outer call is the last one.
 */
export function lastWhere(db: DrizzleMock): unknown {
  return db.where.mock.calls.at(-1)?.[0];
}

/** Render a Drizzle condition to SQL text + bound params so tests can assert on filters. */
export function renderSql(condition: unknown): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(condition as SQL);
}
