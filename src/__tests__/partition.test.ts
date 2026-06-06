import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { partitionToolCalls } from '../agent/partition.js';
import type { ToolDef, ToolCall } from '../agent/types.js';

function makeTool(name: string, safe: boolean): ToolDef {
  return {
    name,
    description: name,
    safety: safe ? 'safe' : 'dangerous',
    concurrencySafe: safe,
    schema: z.object({}),
    execute: async () => ({}),
  };
}

function makeCall(id: string, name: string): ToolCall {
  return { id, type: 'function', function: { name, arguments: '{}' } };
}

describe('partitionToolCalls', () => {
  it('全 safe 合并成一批', () => {
    const tools = [makeTool('a', true), makeTool('b', true), makeTool('c', true)];
    const calls = [makeCall('1', 'a'), makeCall('2', 'b'), makeCall('3', 'c')];
    const batches = partitionToolCalls(calls, tools);
    expect(batches).toHaveLength(1);
    expect(batches[0].map((c) => c.id)).toEqual(['1', '2', '3']);
  });
});
