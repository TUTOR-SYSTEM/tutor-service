/** Khớp với api-routes.schema.ts của gateway (đã validate ở gateway). */
export type SaveApiRouteResultDto = {
  status: 'todo' | 'pass' | 'fail' | 'blocked' | 'skip';
  doc: Record<string, unknown>;
};
