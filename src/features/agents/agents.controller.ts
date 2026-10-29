import { Controller, Post, UseGuards } from '@nestjs/common';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { Roles } from '@packages/decorators';
import { RolesGuard } from '@packages/guards';
import { AgentsService } from './agents.service';

@Controller()
export class AgentController {
  constructor(private readonly agentsService: AgentsService) {}

  // Each call starts a paid Claude Agent SDK session: staff only, not every authenticated role.
  @Post('run')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'TUTOR')
  run(): Promise<SDKMessage[]> {
    return this.agentsService.run('1+1=?');
  }
}
