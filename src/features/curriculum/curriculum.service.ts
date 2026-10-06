import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ERROR_MESSAGES } from 'src/data/constants';
import { CurriculumRepository } from './curriculum.repository';
import { UserService } from '../user/user.service';
import { type GetCurriculumsQueryDto, type CreateCurriculumDto } from '@packages/entities';
import { checkUuidValid, generateCode } from '@packages/helpers';

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
    createCurriculum: CreateCurriculumDto;
  }) {
    if (!userId || !checkUuidValid({ data: userId })) {
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);
    }

    if (!(await this.userService.userExists(userId)))
      throw new BadRequestException(ERROR_MESSAGES.USER_NOT_FOUND);
    return await this.curriculumRepository.create({ userId, data: createCurriculum });
  }

  async getAllCurriculumService({
    userId,
    query,
  }: {
    userId: string;
    query: GetCurriculumsQueryDto;
  }) {
    this.logger.log('user id : ', userId);
    if (!userId || !checkUuidValid({ data: userId })) {
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);
    }

    if (!(await this.userService.userExists(userId)))
      throw new BadRequestException(ERROR_MESSAGES.USER_NOT_FOUND);
    this.logger.log('query :', query);
    return await this.curriculumRepository.findAll({
      page: query.page,
      limit: query.limit,
      search: query.search,
    });
  }

  async getCurriculumByIdService({ userId, id }: { userId: string; id: string }) {
    if (!userId || !checkUuidValid({ data: userId })) {
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);
    }
    if (!id || !checkUuidValid({ data: id })) {
      throw new BadRequestException(ERROR_MESSAGES.CURRICULUM_ID_INVALID);
    }

    if (!(await this.userService.userExists(userId)))
      throw new BadRequestException(ERROR_MESSAGES.USER_NOT_FOUND);
    return await this.curriculumRepository.findByIdWithDetails(id);
  }

  async updateCurriculumService({
    userId,
    id,
    data,
  }: {
    userId: string;
    id: string;
    data: CreateCurriculumDto;
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
    if (!existing) throw new NotFoundException(ERROR_MESSAGES.CURRICULUM_NOT_FOUND);

    return await this.curriculumRepository.update(id, data);
  }

  async deleteCurriculumService({ userId, id }: { userId: string; id: string }) {
    if (!userId || !checkUuidValid({ data: userId })) {
      throw new BadRequestException(ERROR_MESSAGES.USER_ID_MUST_BE_UUID);
    }
    if (!id || !checkUuidValid({ data: id })) {
      throw new BadRequestException(ERROR_MESSAGES.CURRICULUM_ID_INVALID);
    }

    if (!(await this.userService.userExists(userId)))
      throw new BadRequestException(ERROR_MESSAGES.USER_NOT_FOUND);
    const existing = await this.curriculumRepository.findById(id);
    if (!existing) throw new NotFoundException(ERROR_MESSAGES.CURRICULUM_NOT_FOUND);

    return await this.curriculumRepository.delete(id);
  }
}
