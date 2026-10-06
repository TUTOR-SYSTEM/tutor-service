import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE } from 'src/database/database.module';
import { drizzle } from 'drizzle-orm/postgres-js';
import { v4 as uuidv4 } from 'uuid';
import { type CreateLessonBodyDto, type UpdateLessonDto } from '@packages/entities';
import { lessons } from '@tutor/gateway/schema';
import { and, count, eq } from 'drizzle-orm';

@Injectable()
export class LessonRepository {
  constructor(@Inject(DRIZZLE) private readonly db: ReturnType<typeof drizzle>) {}

  async create({
    curriculumId,
    chapterId,
    data,
  }: {
    curriculumId: string;
    chapterId?: string | null;
    data: CreateLessonBodyDto;
  }) {
    const [lesson] = await this.db
      .insert(lessons)
      .values({
        id: uuidv4(),
        curriculumId,
        chapterId: chapterId ?? null,
        title: data.title,
        description: data.description ?? null,
        theoryUrls: data.theoryUrls ?? [],
        exerciseUrls: data.exerciseUrls ?? [],
        order: data.order ?? 0,
      })
      .returning();
    return lesson;
  }

  async findAll({
    curriculumId,
    chapterId,
    page = 1,
    limit = 10,
  }: {
    curriculumId: string;
    chapterId?: string;
    page?: number;
    limit?: number;
  }) {
    const conditions = [eq(lessons.curriculumId, curriculumId)];
    if (chapterId) {
      conditions.push(eq(lessons.chapterId, chapterId));
    }
    const whereClause = and(...conditions);

    const [totalRow] = await this.db.select({ total: count() }).from(lessons).where(whereClause);
    const total = Number(totalRow?.total ?? 0);
    const pageNumber = Number(page);
    const limitNumber = Number(limit);
    const offset = (pageNumber - 1) * limitNumber;

    const rows = await this.db
      .select()
      .from(lessons)
      .where(whereClause)
      // stable order — without it OFFSET pagination can repeat/skip rows between pages
      .orderBy(lessons.order, lessons.id)
      .limit(limitNumber)
      .offset(offset);

    return {
      lessons: rows,
      pagination: {
        total,
        page: pageNumber,
        limit: limitNumber,
        totalPages: Math.ceil(total / limitNumber),
      },
    };
  }

  async findById(id: string) {
    const [lesson] = await this.db.select().from(lessons).where(eq(lessons.id, id)).limit(1);
    return lesson ?? null;
  }

  async update(id: string, data: UpdateLessonDto) {
    const [lesson] = await this.db.update(lessons).set(data).where(eq(lessons.id, id)).returning();
    return lesson ?? null;
  }

  async delete(id: string) {
    const [lesson] = await this.db.delete(lessons).where(eq(lessons.id, id)).returning();
    return !!lesson;
  }
}
