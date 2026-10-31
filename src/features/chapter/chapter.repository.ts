import { Injectable } from '@nestjs/common';
import { PrismaService, isRecordNotFound } from '../../database/prisma.service';
import { type CreateChapterDto, type UpdateChapterDto } from '@packages/entities';
import { buildPagination } from '@packages/helpers';

@Injectable()
export class ChapterRepository {
  constructor(private readonly prisma: PrismaService) {}

  async curriculumExists(id: string): Promise<boolean> {
    const curriculum = await this.prisma.curriculum.findUnique({
      where: { id },
      select: { id: true },
    });
    return !!curriculum;
  }

  async create({ curriculumId, data }: { curriculumId: string; data: CreateChapterDto }) {
    return this.prisma.chapter.create({
      data: {
        curriculumId,
        title: data.title,
        description: data.description ?? null,
        order: data.order ?? 0,
      },
    });
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
    const where = { curriculumId };
    const pageNumber = Number(page);
    const limitNumber = Number(limit);

    const [total, rows] = await Promise.all([
      this.prisma.chapter.count({ where }),
      this.prisma.chapter.findMany({
        where,
        // stable order — without it OFFSET pagination can repeat/skip rows between pages
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
        take: limitNumber,
        skip: (pageNumber - 1) * limitNumber,
      }),
    ]);

    return { chapters: rows, pagination: buildPagination(total, pageNumber, limitNumber) };
  }

  async findById(id: string) {
    return this.prisma.chapter.findUnique({ where: { id } });
  }

  async update(id: string, data: UpdateChapterDto) {
    try {
      return await this.prisma.chapter.update({ where: { id }, data });
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  async delete(id: string) {
    const { count } = await this.prisma.chapter.deleteMany({ where: { id } });
    return count > 0;
  }
}
