import { describe, it, expect } from 'vitest';
import { readFileTool } from '../tools/read_file.js';
import { globTool } from '../tools/glob.js';
import { grepTool } from '../tools/grep.js';
import { writeFileTool } from '../tools/write_file.js';
import { editFileTool } from '../tools/edit_file.js';
import { deleteFileTool } from '../tools/delete_file.js';
import { httpFetchTool } from '../tools/http_fetch.js';

describe('工具并发安全标记', () => {
  it('read_file / glob / grep 是 concurrencySafe', () => {
    expect(readFileTool.concurrencySafe).toBe(true);
    expect(globTool.concurrencySafe).toBe(true);
    expect(grepTool.concurrencySafe).toBe(true);
  });

  it('write / edit / delete / http_fetch 都不是 concurrencySafe', () => {
    expect(writeFileTool.concurrencySafe ?? false).toBe(false);
    expect(editFileTool.concurrencySafe ?? false).toBe(false);
    expect(deleteFileTool.concurrencySafe ?? false).toBe(false);
    // http_fetch 取决于 method,工具本身标 unsafe(默认 false)
    // GET 安全在 partition 层用动态判断(简化:本任务先静态 unsafe)
    expect(httpFetchTool.concurrencySafe ?? false).toBe(false);
  });
});
