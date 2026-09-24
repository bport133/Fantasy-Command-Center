// Key/value persistence. In production this is the app_state table in Supabase Postgres;
// tests use the in-memory version.

export interface Store {
  get<T>(key: string, fallback: T): Promise<T>;
  set(key: string, value: unknown): Promise<void>;
}

export function memoryStore(initial: Record<string, unknown> = {}): Store & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = structuredClone(initial);
  return {
    data,
    async get<T>(key: string, fallback: T) {
      return key in data ? (structuredClone(data[key]) as T) : fallback;
    },
    async set(key: string, value: unknown) {
      data[key] = structuredClone(value);
    },
  };
}
