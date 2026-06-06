import { z } from 'zod';
import type { ToolDef } from '../agent/types.js';

const schema = z.object({
  todos: z
    .array(
      z.object({
        status: z.enum(['pending', 'in_progress', 'completed']),
        content: z.string().min(1).max(200),
      }),
    )
    .min(1)
    .max(7),
});

async function execute(
  input: z.infer<typeof schema>,
  ctx: import('../agent/types.js').ToolCtx,
): Promise<{ count: number }> {
  ctx.sessionState.setTodos(input.todos);
  // 触发 UI re-render 由 sessionState.onChange 负责(由 app.tsx 订阅)
  return { count: input.todos.length };
}

export const todoWriteTool: ToolDef<z.infer<typeof schema>> = {
  name: 'todo_write',
  description:
    '更新当前会话的任务清单(1-7 条)。每条 status ∈ pending / in_progress / completed,content 一句话说明。多步任务开始时调用,每完成一个步骤就更新 status。任务 <= 3 步时不必调用。',
  safety: 'safe',
  schema,
  execute,
};
