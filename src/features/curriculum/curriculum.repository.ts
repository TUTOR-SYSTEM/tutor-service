import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, isRecordNotFound } from '../../database/prisma.service';
import { type CreateCurriculumDto, UpdateCurriculumDto } from '@packages/entities';
import { buildListWhereClause, buildPagination } from '@packages/helpers';

@Injectable()
export class CurriculumRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByCode(code: string) {
    return this.prisma.curriculum.findFirst({ where: { code } });
  }

  async create({ userId, data }: { userId: string; data: CreateCurriculumDto }) {
    const { subject, code, grade, description, courseTime } = data;
    return this.prisma.curriculum.create({
      data: {
        userId,
        code,
        grade: String(grade),
        subject,
        gradesId: null,
        courseTime,
        description: description ?? null,
      },
    });
  }

  async findAll({
    page = 1,
    limit = 10,
    search,
  }: {
    page?: number;
    limit?: number;
    search?: string;
  }) {
    const where = buildListWhereClause({
      search,
      searchFields: ['subject', 'code'],
    }) as Prisma.CurriculumWhereInput | undefined;

    const pageNumber = Number(page);
    const limitNumber = Number(limit);

    const [total, rows] = await Promise.all([
      this.prisma.curriculum.count({ where }),
      this.prisma.curriculum.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: limitNumber,
        skip: (pageNumber - 1) * limitNumber,
        include: { _count: { select: { chapters: true, lessons: true } } },
      }),
    ]);

    return {
      curriculums: rows.map(({ _count, ...row }) => ({
        ...row,
        chapterCount: _count.chapters,
        lessonCount: _count.lessons,
      })),
      pagination: buildPagination(total, pageNumber, limitNumber),
    };
  }

  async findById(id: string) {
    return this.prisma.curriculum.findUnique({ where: { id } });
  }

  async findByIdWithDetails(id: string) {
    const curriculum = await this.prisma.curriculum.findUnique({ where: { id } });
    if (!curriculum) return null;

    const [chapterRows, lessonRows] = await Promise.all([
      this.prisma.chapter.findMany({ where: { curriculumId: id }, orderBy: { order: 'asc' } }),
      this.prisma.lesson.findMany({ where: { curriculumId: id }, orderBy: { order: 'asc' } }),
    ]);

    const chaptersWithLessons = chapterRows.map((chapter) => ({
      ...chapter,
      lessons: lessonRows.filter((l) => l.chapterId === chapter.id),
    }));

    return {
      ...curriculum,
      chapterCount: chapterRows.length,
      lessonCount: lessonRows.length,
      chapters: chaptersWithLessons,
      lessons: lessonRows.filter((l) => !l.chapterId),
    };
  }

  async update(id: string, data: UpdateCurriculumDto) {
    const updateData: Prisma.CurriculumUncheckedUpdateInput = {
      ...data,
      grade: data.grade !== undefined ? String(data.grade) : undefined,
    };
    try {
      return await this.prisma.curriculum.update({ where: { id }, data: updateData });
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  async delete(id: string) {
    const { count } = await this.prisma.curriculum.deleteMany({ where: { id } });
    return count > 0;
  }
}
