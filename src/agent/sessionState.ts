export interface TodoItem {
  status: 'pending' | 'in_progress' | 'completed';
  content: string;
}

export interface SessionState {
  readonly todos: TodoItem[];
  setTodos(next: TodoItem[]): void;
  /** 清空当前 session 的内部状态(todos 等),不重新触发 onChange 之外的副作用 */
  reset(): void;
  onChange?: (todos: TodoItem[]) => void;
}

export function createSessionState(): SessionState {
  let todos: TodoItem[] = [];
  return {
    get todos() { return todos; },
    setTodos(next) {
      todos = next;
      const cb = this.onChange;
      cb?.(todos);
    },
    reset() {
      todos = [];
      const cb = this.onChange;
      cb?.(todos);
    },
    onChange: undefined,
  };
}
