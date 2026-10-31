/**
 * Build the `where` object for a list API (Prisma):
 * - `search`: OR across `searchFields` (case-insensitive `contains`)
 * - `filters`: AND exact-match conditions, skipping undefined/null
 * Returns `undefined` when there is nothing to filter on.
 */
export type BuildListWhereParams<TFilterField extends string, TFilterValue> = {
  search?: string;
  searchFields?: readonly string[];
  filters?: Partial<Record<TFilterField, TFilterValue | null | undefined>>;
};

export function buildListWhereClause<TFilterField extends string, TFilterValue>({
  search,
  searchFields = [],
  filters,
}: BuildListWhereParams<TFilterField, TFilterValue>): Record<string, unknown> | undefined {
  const conditions: Record<string, unknown>[] = [];

  const term = search?.trim();
  if (term && searchFields.length > 0) {
    conditions.push({
      OR: searchFields.map((field) => ({ [field]: { contains: term, mode: 'insensitive' } })),
    });
  }

  for (const [field, value] of Object.entries(filters ?? {})) {
    if (value === undefined || value === null) continue;
    conditions.push({ [field]: value });
  }

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return { AND: conditions };
}

/** Standard `{ total, page, limit, totalPages }` block returned by every list endpoint. */
export function buildPagination(total: number, page: number, limit: number) {
  return { total, page, limit, totalPages: Math.ceil(total / limit) };
}
