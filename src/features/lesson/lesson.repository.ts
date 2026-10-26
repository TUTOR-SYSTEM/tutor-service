import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, isRecordNotFound } from '../../database/prisma.service';
import { type CreateLessonBodyDto, type UpdateLessonDto } from '@packages/entities';
import { buildPagination } from '@packages/helpers';

@Injectable()
export class LessonRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create({
    curriculumId,
    chapterId,
    data,
  }: {
    curriculumId: string;
    chapterId?: string | null;
    data: CreateLessonBodyDto;
  }) {
    return this.prisma.lesson.create({
      data: {
        curriculumId,
        chapterId: chapterId ?? null,
        title: data.title,
        description: data.description ?? null,
        theoryUrls: data.theoryUrls ?? [],
        exerciseUrls: data.exerciseUrls ?? [],
        order: data.order ?? 0,
      },
    });
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
    const where: Prisma.LessonWhereInput = { curriculumId, ...(chapterId && { chapterId }) };
    const pageNumber = Number(page);
    const limitNumber = Number(limit);

    const [total, rows] = await Promise.all([
      this.prisma.lesson.count({ where }),
      this.prisma.lesson.findMany({
        where,
        // stable order — without it OFFSET pagination can repeat/skip rows between pages
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
        take: limitNumber,
        skip: (pageNumber - 1) * limitNumber,
      }),
    ]);

    return { lessons: rows, pagination: buildPagination(total, pageNumber, limitNumber) };
  }

  async findById(id: string) {
    return this.prisma.lesson.findUnique({ where: { id } });
  }

  async update(id: string, data: UpdateLessonDto) {
    try {
      return await this.prisma.lesson.update({ where: { id }, data });
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  async delete(id: string) {
    const { count } = await this.prisma.lesson.deleteMany({ where: { id } });
    return count > 0;
  }
}
