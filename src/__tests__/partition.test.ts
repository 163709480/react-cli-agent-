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

  it('safe / unsafe 交替:每出现 unsafe 就切新批', () => {
    const tools = [makeTool('a', true), makeTool('b', false), makeTool('c', true)];
    const calls = [
      makeCall('1', 'a'),
      makeCall('2', 'a'),
      makeCall('3', 'b'),
      makeCall('4', 'c'),
      makeCall('5', 'a'),
      makeCall('6', 'b'),
    ];
    const batches = partitionToolCalls(calls, tools);
    expect(batches.map((b) => b.map((c) => c.id))).toEqual([
      ['1', '2'],
      ['3'],
      ['4', '5'],
      ['6'],
    ]);
  });

  it('全 unsafe:每个 call 单独一批', () => {
    const tools = [makeTool('a', false), makeTool('b', false)];
    const calls = [makeCall('1', 'a'), makeCall('2', 'b'), makeCall('3', 'a')];
    const batches = partitionToolCalls(calls, tools);
    expect(batches).toHaveLength(3);
    expect(batches.map((b) => b[0].id)).toEqual(['1', '2', '3']);
  });
});
