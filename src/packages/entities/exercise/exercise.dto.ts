import {
  createExerciseSchema,
  getExerciseQuerySchema,
  gradeExerciseSchema,
  submitExerciseSchema,
} from './exercise.schema';
import z from 'zod';

export type CreateExerciseDto = z.infer<typeof createExerciseSchema>;
export type SubmitExerciseDto = z.infer<typeof submitExerciseSchema>;
export type GradeExerciseDto = z.infer<typeof gradeExerciseSchema>;
export type getExerciseDto = z.infer<typeof getExerciseQuerySchema>;

export type ExerciseStatus = 'SUBMITTED' | 'GRADED' | 'RESUBMIT';

export type ExerciseDetailDto = {
  id: string;
  lessonId: string | null;
  sessionId: string | null;
  tutorId: string;
  studentId: string;
  issueUrls: { name: string; url: string; key: string }[];
  exerciseUrls: { name: string; url: string; key: string }[];
  answerKeyUrls: { name: string; url: string; key: string }[];
  status: ExerciseStatus;
  score: number | null;
  comment: string | null;
  gradedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
