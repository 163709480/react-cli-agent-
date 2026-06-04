import { describe, it, expect } from 'vitest';
import { httpFetchTool } from '../../tools/http_fetch.js';

describe('http_fetch', () => {
  it('safety 等级是 dangerous', () => {
    expect(httpFetchTool.safety).toBe('dangerous');
  });

  it('POST 无 allowMutations 抛错', async () => {
    await expect(
      httpFetchTool.execute(
        { url: 'https://example.com', method: 'POST', body: '{}' },
        { cwd: '/tmp', abort: new AbortController().signal, confirmedByUser: true },
      ),
    ).rejects.toThrow(/--allow-mutations/);
  });
});
