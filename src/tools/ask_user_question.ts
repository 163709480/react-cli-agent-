import { z } from 'zod';
import type { ToolDef, AskUserAnswer } from '../agent/types.js';

const schema = z.object({
  question: z.string().min(1).max(200),
  options: z.array(z.string().min(1).max(50)).min(2).max(4),
  multiSelect: z.boolean().default(false),
});

async function execute(
  input: z.infer<typeof schema>,
  ctx: import('../agent/types.js').ToolCtx,
): Promise<AskUserAnswer> {
  const req = { question: input.question, options: input.options, multiSelect: input.multiSelect };
  const answer = await ctx.onAskUser(req);
  return answer;
}

export const askUserQuestionTool: ToolDef<z.infer<typeof schema>, z.input<typeof schema>> = {
  name: 'ask_user_question',
  description:
    '向用户展示一个 2-4 选项的单/多选题并等待回答。仅在你需要在互斥方案中让用户决策时使用。不要用于 yes/no(直接做或直接拒绝),不要用于开放问题(用户也会取消)。选项要互斥、明确。',
  safety: 'safe',
  schema,
  execute,
};
