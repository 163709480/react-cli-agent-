export interface TodoItem {
  status: 'pending' | 'in_progress' | 'completed';
  content: string;
}

export interface SessionState {
  readonly todos: TodoItem[];
  setTodos(next: TodoItem[]): void;
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
    onChange: undefined,
  };
}
