import { query } from '@anthropic-ai/claude-agent-sdk';
import { AgentsService } from 'src/features/agents/agents.service';

// regression (TUT3-03, TUT3-31): the chat prompt is end-user text, so the agent runs with no
// built-in tools and no settings/hooks from cwd; the reply is read from the SDK result message.
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: jest.fn() }));

const USER_ID = '11111111-1111-4111-8111-111111111111';

function stream(messages: unknown[]) {
  return (async function* () {
    for (const m of messages) yield m;
  })();
}

describe('AgentsService', () => {
  let service: AgentsService;
  const queryMock = query as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AgentsService();
  });

  describe('sandboxed query options', () => {
    it('disables built-in tools, loads no settings and caps turns', async () => {
      queryMock.mockReturnValue(stream([]));

      await service.run('hi', {
        tools: ['Bash'],
        allowedTools: ['Bash'],
        permissionMode: 'bypassPermissions',
      });

      const options = queryMock.mock.calls[0][0].options;
      expect(options).toMatchObject({
        tools: [],
        allowedTools: [],
        permissionMode: 'default',
        settingSources: [],
        maxTurns: 3,
      });
      expect(options.cwd).toEqual(expect.any(String));
      expect(options.cwd).not.toBe(process.cwd());
    });
  });

  describe('chat reply', () => {
    it('returns the final success result text', async () => {
      queryMock.mockReturnValue(
        stream([
          { type: 'assistant', message: { content: [{ type: 'text', text: 'draft' }] } },
          { type: 'result', subtype: 'success', result: '  Xin chào  ', is_error: false },
        ]),
      );

      const { reply } = await service.chat({
        userId: USER_ID,
        data: { message: 'hello' } as never,
      });

      expect(reply.content).toBe('Xin chào');
    });

    it('falls back to assistant text blocks when there is no success result', async () => {
      queryMock.mockReturnValue(
        stream([
          {
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'Một' }, { type: 'tool_use' }] },
          },
          { type: 'assistant', message: { content: [{ type: 'text', text: 'Hai' }] } },
        ]),
      );

      const { reply } = await service.chat({
        userId: USER_ID,
        data: { message: 'hello' } as never,
      });

      expect(reply.content).toBe('Một\nHai');
    });

    it('returns the default text when the agent produced nothing', async () => {
      queryMock.mockReturnValue(stream([]));

      const { reply } = await service.chat({
        userId: USER_ID,
        data: { message: 'hello' } as never,
      });

      expect(reply.content).toBe('Không có phản hồi từ trợ lý.');
    });
  });
});
