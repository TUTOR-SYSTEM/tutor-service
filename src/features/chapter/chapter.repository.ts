import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE } from 'src/database/database.module';
import { drizzle } from 'drizzle-orm/postgres-js';
import { v4 as uuidv4 } from 'uuid';
import { type CreateChapterDto, type UpdateChapterDto } from '@packages/entities';
import { chapters } from '@tutor/gateway/schema';
import { count, eq } from 'drizzle-orm';

@Injectable()
export class ChapterRepository {
  constructor(@Inject(DRIZZLE) private readonly db: ReturnType<typeof drizzle>) {}

  async create({ curriculumId, data }: { curriculumId: string; data: CreateChapterDto }) {
    const [chapter] = await this.db
      .insert(chapters)
      .values({
        id: uuidv4(),
        curriculumId,
        title: data.title,
        description: data.description ?? null,
        order: data.order ?? 0,
      })
      .returning();
    return chapter;
  }

  async findAll({
    curriculumId,
    page = 1,
    limit = 10,
  }: {
    curriculumId: string;
    page?: number;
    limit?: number;
  }) {
    const whereClause = eq(chapters.curriculumId, curriculumId);
    const [totalRow] = await this.db.select({ total: count() }).from(chapters).where(whereClause);
    const total = Number(totalRow?.total ?? 0);
    const pageNumber = Number(page);
    const limitNumber = Number(limit);
    const offset = (pageNumber - 1) * limitNumber;

    const rows = await this.db
      .select()
      .from(chapters)
      .where(whereClause)
      .limit(limitNumber)
      .offset(offset);

    return {
      chapters: rows,
      pagination: {
        total,
        page: pageNumber,
        limit: limitNumber,
        totalPages: Math.ceil(total / limitNumber),
      },
    };
  }

  async findById(id: string) {
    const [chapter] = await this.db.select().from(chapters).where(eq(chapters.id, id));
    return chapter ?? null;
  }

  async update(id: string, data: UpdateChapterDto) {
    const [chapter] = await this.db
      .update(chapters)
      .set(data)
      .where(eq(chapters.id, id))
      .returning();
    return chapter ?? null;
  }

  async delete(id: string) {
    const [chapter] = await this.db.delete(chapters).where(eq(chapters.id, id)).returning();
    return !!chapter;
  }
}
