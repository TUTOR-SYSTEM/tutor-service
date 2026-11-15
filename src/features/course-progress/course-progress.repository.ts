import { Injectable } from '@nestjs/common';
import { CourseItemKind, type Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type {
  CourseProgressSnapshot,
  CourseResultsDto,
  CourseTestRowDto,
} from '@packages/entities/course-progress';

const toMs = (d: Date | null) => (d ? d.getTime() : null);

@Injectable()
export class CourseProgressRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ghi tiến độ của một user. Chỉ bổ sung/cộng dồn, không xoá: lịch sử được giữ lại.
   * Mọi thao tác nằm trong một transaction.
   */
  async saveSnapshot(userId: string, s: CourseProgressSnapshot, now = new Date()): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // 1. Đáp án quiz: giữ đáp án đầu tiên, cộng dồn số sai, OR cờ.
      const lessonIds = new Set<string>([
        ...Object.keys(s.quiz),
        ...Object.keys(s.wrong),
        ...Object.keys(s.flag),
      ]);
      const existing = await tx.courseQuizAnswer.findMany({
        where: { userId, lessonId: { in: [...lessonIds] } },
      });
      const byKey = new Map(existing.map((a) => [`${a.lessonId}:${a.questionIndex}`, a]));
      for (const lid of lessonIds) {
        const qs = new Set<string>([
          ...Object.keys(s.quiz[lid] ?? {}),
          ...Object.keys(s.wrong[lid] ?? {}),
          ...Object.keys(s.flag[lid] ?? {}),
        ]);
        for (const qKey of qs) {
          const q = Number(qKey);
          const option = s.quiz[lid]?.[qKey] ?? null;
          const wrong = s.wrong[lid]?.[qKey] ?? 0;
          const flagged = s.flag[lid]?.[qKey] === true;
          const cur = byKey.get(`${lid}:${q}`);
          if (!cur) {
            await tx.courseQuizAnswer.create({
              data: {
                userId,
                lessonId: lid,
                questionIndex: q,
                optionIndex: option,
                wrongCount: wrong,
                flagged,
                answeredAt: now,
              },
            });
            continue;
          }
          const next = {
            optionIndex: cur.optionIndex ?? option,
            wrongCount: Math.max(cur.wrongCount, wrong),
            flagged: cur.flagged || flagged,
          };
          if (
            next.optionIndex !== cur.optionIndex ||
            next.wrongCount !== cur.wrongCount ||
            next.flagged !== cur.flagged
          ) {
            await tx.courseQuizAnswer.update({
              where: { userId_lessonId_questionIndex: { userId, lessonId: lid, questionIndex: q } },
              data: next,
            });
          }
        }
      }

      // 2. Lịch sử làm quiz (mỗi lần một dòng; trùng thời điểm thì bỏ qua).
      if (s.hist.length) {
        await tx.courseQuizAttempt.createMany({
          data: s.hist.map((h) => ({
            userId,
            lessonId: h.l,
            score: h.s,
            total: h.n,
            completedAt: new Date(h.t),
          })),
          skipDuplicates: true,
        });
      }

      // 3. Lab và debug đã đạt: lần đầu server thấy đạt thì ghi, các lần sau bỏ qua.
      const items: Prisma.CourseItemResultCreateManyInput[] = [];
      for (const [lid, arr] of Object.entries(s.labs)) {
        arr.forEach((ok, i) => {
          if (ok) items.push({ userId, lessonId: lid, kind: CourseItemKind.LAB, itemKey: String(i), passedAt: now });
        });
      }
      for (const [id, ok] of Object.entries(s.debugs)) {
        const lid = s.debugModule[id];
        if (ok && lid) items.push({ userId, lessonId: lid, kind: CourseItemKind.DEBUG, itemKey: id, passedAt: now });
      }
      if (items.length) await tx.courseItemResult.createMany({ data: items, skipDuplicates: true });

      // 4. Tổng hợp học tập cho các module có thay đổi, tính lại từ dữ liệu đã lưu.
      const touched = new Set<string>([
        ...Object.keys(s.labs),
        ...lessonIds,
        ...s.hist.map((h) => h.l),
        ...Object.values(s.debugModule),
      ]);
      for (const lid of touched) {
        const attempts = await tx.courseQuizAttempt.count({ where: { userId, lessonId: lid } });
        const best = await tx.courseQuizAttempt.findFirst({
          where: { userId, lessonId: lid },
          orderBy: [{ score: 'desc' }, { completedAt: 'asc' }],
        });
        const last = await tx.courseQuizAttempt.findFirst({
          where: { userId, lessonId: lid },
          orderBy: { completedAt: 'desc' },
        });
        const labsPassed = await tx.courseItemResult.count({
          where: { userId, lessonId: lid, kind: CourseItemKind.LAB },
        });
        const debugsSolved = await tx.courseItemResult.count({
          where: { userId, lessonId: lid, kind: CourseItemKind.DEBUG },
        });
        const wrongAgg = await tx.courseQuizAnswer.aggregate({
          where: { userId, lessonId: lid },
          _sum: { wrongCount: true },
        });
        const flagged = await tx.courseQuizAnswer.count({ where: { userId, lessonId: lid, flagged: true } });
        const prev = await tx.courseLearningResult.findUnique({
          where: { userId_lessonId: { userId, lessonId: lid } },
        });
        const labsTotal = Math.max(prev?.labsTotal ?? 0, s.labs[lid]?.length ?? 0);
        const data = {
          quizAttempts: attempts,
          quizBest: best?.score ?? null,
          quizTotal: best?.total ?? null,
          quizLastAt: last?.completedAt ?? null,
          labsPassed,
          labsTotal,
          debugsSolved,
          wrongTotal: wrongAgg._sum.wrongCount ?? 0,
          flagged,
          updatedAt: now,
        };
        await tx.courseLearningResult.upsert({
          where: { userId_lessonId: { userId, lessonId: lid } },
          create: { userId, lessonId: lid, ...data },
          update: data,
        });
      }
    });
  }

  /** Kết quả học tập và lịch sử test của một user. */
  async getResults(userId: string, limit = 200): Promise<CourseResultsDto> {
    const [rows, attempts, items] = await Promise.all([
      this.prisma.courseLearningResult.findMany({ where: { userId }, orderBy: { lessonId: 'asc' } }),
      this.prisma.courseQuizAttempt.findMany({
        where: { userId },
        orderBy: { completedAt: 'desc' },
        take: limit,
      }),
      this.prisma.courseItemResult.findMany({
        where: { userId },
        orderBy: { passedAt: 'desc' },
        take: limit,
      }),
    ]);

    const tests: CourseTestRowDto[] = [
      ...attempts.map((a) => ({
        moduleId: a.lessonId,
        kind: 'quiz' as const,
        itemKey: '',
        score: a.score,
        total: a.total,
        passed: a.score === a.total,
        at: a.completedAt.getTime(),
      })),
      ...items.map((i): CourseTestRowDto => ({
        moduleId: i.lessonId,
        kind: i.kind === CourseItemKind.LAB ? 'lab' : 'debug',
        itemKey: i.itemKey,
        score: null,
        total: null,
        passed: true,
        at: i.passedAt.getTime(),
      })),
    ]
      .sort((a, b) => b.at - a.at)
      .slice(0, limit);

    return {
      modules: rows.map((r) => ({
        lessonId: r.lessonId,
        quizAttempts: r.quizAttempts,
        quizBest: r.quizBest == null ? null : { score: r.quizBest, total: r.quizTotal ?? 0 },
        quizLastAt: toMs(r.quizLastAt),
        wrongTotal: r.wrongTotal,
        flagged: r.flagged,
        labsPassed: r.labsPassed,
        labsTotal: r.labsTotal,
        debugsSolved: r.debugsSolved,
      })),
      tests,
      syncedAt: rows.length ? Math.max(...rows.map((r) => r.updatedAt.getTime())) : null,
    };
  }
}
