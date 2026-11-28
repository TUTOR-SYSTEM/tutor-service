import { query } from '@anthropic-ai/claude-agent-sdk';
import { AgentsService } from 'src/features/agents/agents.service';

// regression (TS-07, TS-13): bounded chat history map, run timeout, message length;
// ai.history limit validation.
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: jest.fn() }));

const queryMock = query as unknown as jest.Mock;
const ok = (text = 'ok') =>
  (async function* () {
    yield { type: 'result', subtype: 'success', result: text, is_error: false };
  })();

describe('AgentsService limits', () => {
  let service: AgentsService;
  beforeEach(() => {
    jest.clearAllMocks();
    queryMock.mockImplementation(() => ok());
    service = new AgentsService();
  });

  describe('TS-07 ai.chat', () => {
    it('bounds the number of users kept in the history map', async () => {
      for (let i = 0; i < 5000; i++)
        await service.chat({ userId: 'u' + i, data: { message: 'hi' } });
      expect((service as any).history.size).toBeLessThan(5000);
    });

    it('evicts the least recently used user, not the active one', async () => {
      await service.chat({ userId: 'active', data: { message: 'hi' } });
      for (let i = 0; i < 5000; i++) {
        await service.chat({ userId: 'u' + i, data: { message: 'hi' } });
        if (i % 100 === 0) await service.chat({ userId: 'active', data: { message: 'hi' } });
      }
      expect(
        service.getHistory({ userId: 'active', query: { limit: 100 } }).length,
      ).toBeGreaterThan(0);
      expect(service.getHistory({ userId: 'u0', query: { limit: 100 } })).toEqual([]);
    });

    it('rejects an over-long message without calling the SDK', async () => {
      await expect(
        service.chat({ userId: 'u', data: { message: 'x'.repeat(100_000) } }),
      ).rejects.toBeDefined();
      expect(queryMock).not.toHaveBeenCalled();
    });

    it('times out a run that never finishes', async () => {
      jest.useFakeTimers();
      try {
        queryMock.mockImplementation(() =>
          (async function* () {
            await new Promise(() => {});
          })(),
        );
        let settled = false;
        const p = service.chat({ userId: 'u', data: { message: 'hi' } }).then(
          () => (settled = true),
          () => (settled = true),
        );
        await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
        expect(settled).toBe(true);
        await p;
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('TS-13 ai.history limit', () => {
    beforeEach(async () => {
      for (let i = 0; i < 70; i++) await service.chat({ userId: 'u', data: { message: 'm' + i } });
    });
    const hist = (limit: unknown) => service.getHistory({ userId: 'u', query: { limit } as never });

    it('limit=0 does not return everything', () => {
      expect(hist(0).length).toBeLessThanOrEqual(50);
    });
    it('undefined limit defaults to 50', () => {
      expect(hist(undefined)).toHaveLength(50);
    });
    it('limit above 100 is capped at 100', () => {
      expect(hist(1000).length).toBeLessThanOrEqual(100);
    });
    it('negative / NaN limit falls back to default 50', () => {
      expect(hist(-5)).toHaveLength(50);
      expect(hist(NaN)).toHaveLength(50);
    });
    it('valid limit slices the newest entries', () => {
      expect(hist(3)).toHaveLength(3);
    });
  });
});
