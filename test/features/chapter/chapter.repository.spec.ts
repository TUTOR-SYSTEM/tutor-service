import { ChapterRepository } from 'src/features/chapter/chapter.repository';
import { createPrismaMock, PrismaMock } from '../../support/prisma.mock';

const CURRICULUM_ID = '11111111-1111-4111-8111-111111111111';

describe('ChapterRepository.curriculumExists', () => {
  let prisma: PrismaMock;
  let repo: ChapterRepository;

  beforeEach(() => {
    prisma = createPrismaMock();
    repo = new ChapterRepository(prisma as never);
  });

  it('returns true when the curriculum row is found', async () => {
    prisma.curriculum.findUnique.mockResolvedValue({ id: CURRICULUM_ID });

    await expect(repo.curriculumExists(CURRICULUM_ID)).resolves.toBe(true);
  });

  it('returns false when no curriculum row matches', async () => {
    prisma.curriculum.findUnique.mockResolvedValue(null);

    await expect(repo.curriculumExists(CURRICULUM_ID)).resolves.toBe(false);
  });

  it('selects only the id of the curriculum with the given id', async () => {
    prisma.curriculum.findUnique.mockResolvedValue({ id: CURRICULUM_ID });

    await repo.curriculumExists(CURRICULUM_ID);

    expect(prisma.curriculum.findUnique).toHaveBeenCalledWith({
      where: { id: CURRICULUM_ID },
      select: { id: true },
    });
  });
});
