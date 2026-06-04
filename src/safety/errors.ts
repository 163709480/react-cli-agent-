export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxError';
  }
}

export class ToolError extends Error {
  constructor(
    public toolName: string,
    message: string,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}
