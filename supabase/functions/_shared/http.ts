// fetch() wrapper with a timeout and readable errors.

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function getJson<T = any>(
  url: string,
  init: { headers?: Record<string, string>; timeoutMs?: number; label?: string } = {},
): Promise<T> {
  const label = init.label ?? new URL(url).host;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'F2-Command-Center', ...init.headers },
      signal: AbortSignal.timeout(init.timeoutMs ?? 30000),
    });
  } catch (err) {
    throw new HttpError(`${label}: ${(err as Error).message}`, 0);
  }
  if (!res.ok) {
    const hint =
      res.status === 401 || res.status === 403
        ? ' (access denied: private league, or credentials missing/expired)'
        : res.status === 404
          ? ' (check the league id and season)'
          : '';
    throw new HttpError(`${label}: HTTP ${res.status}${hint}`, res.status);
  }
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(`${label}: response was not JSON`, res.status);
  }
}

/** MFL returns a bare object instead of a one-element array. */
export function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}
