/** Kết quả đồng bộ từ client (đã validate ở gateway). Khớp với course-progress.schema.ts của gateway. */
export type CourseProgressSnapshot = {
  labs: Record<string, boolean[]>;
  quiz: Record<string, Record<string, number>>;
  debugs: Record<string, boolean>;
  hist: { l: string; s: number; n: number; t: number }[];
  wrong: Record<string, Record<string, number>>;
  flag: Record<string, Record<string, boolean>>;
  debugModule: Record<string, string>;
};

export type CourseModuleResultDto = {
  lessonId: string;
  quizAttempts: number;
  quizBest: { score: number; total: number } | null;
  quizLastAt: number | null;
  wrongTotal: number;
  flagged: number;
  labsPassed: number;
  labsTotal: number;
  debugsSolved: number;
};

export type CourseTestRowDto = {
  moduleId: string;
  kind: 'quiz' | 'lab' | 'debug';
  itemKey: string;
  score: number | null;
  total: number | null;
  passed: boolean;
  at: number;
};

export type CourseResultsDto = {
  modules: CourseModuleResultDto[];
  tests: CourseTestRowDto[];
  syncedAt: number | null;
};
