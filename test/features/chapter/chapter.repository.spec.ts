import { ChapterRepository } from 'src/features/chapter/chapter.repository';
import { curriculums } from 'src/database/schema';
import { createDrizzleMock, DrizzleMock, lastWhere, renderSql } from '../../support/drizzle.mock';

// chapter.repository imports uuid (ESM-only in v14, jest cannot parse it). Only create() uses it
// and this spec never calls create(), so a stub keeps the module loadable without touching asserts.
jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000000' }));

const CURRICULUM_ID = '11111111-1111-4111-8111-111111111111';

describe('ChapterRepository.curriculumExists', () => {
  let db: DrizzleMock;
  let repo: ChapterRepository;

  beforeEach(() => {
    db = createDrizzleMock();
    repo = new ChapterRepository(db as never);
  });

  it('returns true when the curriculum row is found', async () => {
    db.queue([{ id: CURRICULUM_ID }]);

    await expect(repo.curriculumExists(CURRICULUM_ID)).resolves.toBe(true);
  });

  it('returns false when no curriculum row matches', async () => {
    db.queue([]);

    await expect(repo.curriculumExists(CURRICULUM_ID)).resolves.toBe(false);
  });

  it('selects only the id from the curriculums table, filtered by the given id, limited to 1', async () => {
    db.queue([{ id: CURRICULUM_ID }]);

    await repo.curriculumExists(CURRICULUM_ID);

    expect(db.select).toHaveBeenCalledWith({ id: curriculums.id });
    expect(db.from).toHaveBeenCalledWith(curriculums);
    expect(db.limit).toHaveBeenCalledWith(1);
    const { sql, params } = renderSql(lastWhere(db));
    expect(sql).toContain('"id" = $1');
    expect(params).toEqual([CURRICULUM_ID]);
  });
});
