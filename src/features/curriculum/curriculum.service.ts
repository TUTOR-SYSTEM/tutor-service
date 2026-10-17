import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ERROR_MESSAGES } from 'src/data/constants';
import { CurriculumRepository } from './curriculum.repository';
import { UserService } from '../user/user.service';
import {
  type GetCurriculumsQueryDto,
  type CreateCurriculumDto,
  type UpdateCurriculumDto,
} from '@packages/entities';
import { canActOnOwned, checkUuidValid, generateCode } from '@packages/helpers';

@Injectable()
export class CurriculumService {
  private readonly logger = new Logger(CurriculumService.name);
  constructor(
    private readonly curriculumRepository: CurriculumRepository,
    private readonly userService: UserService,
  ) {}

  async generateNewCodeService(): Promise<string | null> {
    const MAX_RETRIES = 5;
    let attempts = 0;
    let newCode = generateCode();

    while (await this.curriculumRepository.findByCode(newCode)) {
      attempts++;
      if (attempts >= MAX_RETRIES) {
        throw new ConflictException(ERROR_MESSAGES.UNABLE_TO_GENERATE_UNIQUE_CODE);
      }
      newCode = generateCode();
    }

    return newCode;
  }

  async createCurriculumService({
    userId,
    createCurriculum,
  }: {
    userId: string;
    role?: string | null;
    createCurriculum: CreateCurriculumDto;
  }) {
    if (!userId || !checkUuidValid({ data: userId })) {
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);
    }

    // only tutors/admins author curricula (every chapter/lesson write is checked against owner)
    const acting = await this.userService.getUserRoleById(userId);
    if (!acting) throw new BadRequestException(ERROR_MESSAGES.USER_NOT_FOUND);
    if (acting.role !== 'TUTOR' && acting.role !== 'ADMIN')
      throw new ForbiddenException(ERROR_MESSAGES.PERMISSION_DENIED);
    return await this.curriculumRepository.create({ userId, data: createCurriculum });
  }

  async getAllCurriculumService({
    userId,
    query,
  }: {
    userId: string;
    role?: string | null;
    query: GetCurriculumsQueryDto;
  }) {
    if (!userId || !checkUuidValid({ data: userId })) {
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);
    }

    if (!(await this.userService.userExists(userId)))
      throw new BadRequestException(ERROR_MESSAGES.USER_NOT_FOUND);
    return await this.curriculumRepository.findAll({
      page: query.page,
      limit: query.limit,
      search: query.search,
    });
  }

  async getCurriculumByIdService({
    userId,
    id,
  }: {
    userId: string;
    role?: string | null;
    id: string;
  }) {
    if (!userId || !checkUuidValid({ data: userId })) {
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);
    }
    if (!id || !checkUuidValid({ data: id })) {
      throw new BadRequestException(ERROR_MESSAGES.CURRICULUM_ID_INVALID);
    }

    if (!(await this.userService.userExists(userId)))
      throw new BadRequestException(ERROR_MESSAGES.USER_NOT_FOUND);
    // catalog read (no owner check); a missing curriculum is a 404, never null + 200
    const curriculum = await this.curriculumRepository.findByIdWithDetails(id);
    if (!curriculum) throw new NotFoundException(ERROR_MESSAGES.CURRICULUM_NOT_FOUND);
    return curriculum;
  }

  async updateCurriculumService({
    userId,
    role,
    id,
    data,
  }: {
    userId: string;
    role?: string | null;
    id: string;
    data: UpdateCurriculumDto;
  }) {
    if (!userId || !checkUuidValid({ data: userId })) {
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);
    }
    if (!id || !checkUuidValid({ data: id })) {
      throw new BadRequestException(ERROR_MESSAGES.CURRICULUM_ID_INVALID);
    }

    if (!(await this.userService.userExists(userId)))
      throw new BadRequestException(ERROR_MESSAGES.USER_NOT_FOUND);
    const existing = await this.curriculumRepository.findById(id);
    // 404 (not 403) for someone else's curriculum, same as class/session ownership checks.
    if (!existing || !canActOnOwned({ userId, role }, existing.userId)) {
      throw new NotFoundException(ERROR_MESSAGES.CURRICULUM_NOT_FOUND);
    }

    return await this.curriculumRepository.update(id, data);
  }

  async deleteCurriculumService({
    userId,
    role,
    id,
  }: {
    userId: string;
    role?: string | null;
    id: string;
  }) {
    if (!userId || !checkUuidValid({ data: userId })) {
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);
    }
    if (!id || !checkUuidValid({ data: id })) {
      throw new BadRequestException(ERROR_MESSAGES.CURRICULUM_ID_INVALID);
    }

    if (!(await this.userService.userExists(userId)))
      throw new BadRequestException(ERROR_MESSAGES.USER_NOT_FOUND);
    const existing = await this.curriculumRepository.findById(id);
    if (!existing || !canActOnOwned({ userId, role }, existing.userId)) {
      throw new NotFoundException(ERROR_MESSAGES.CURRICULUM_NOT_FOUND);
    }

    return await this.curriculumRepository.delete(id);
  }
}
