import { useMemo, useState, type ReactNode } from 'react';
import type { Platform } from '../../shared/types';

export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  /** Value used for sorting; defaults to row[key]. */
  sort?: (row: T) => number | string | undefined | null;
  align?: 'left' | 'right' | 'center';
  width?: string;
  /** Let long text wrap instead of widening the table. */
  wrap?: boolean;
}

export function Table<T>({
  rows,
  columns,
  rowKey,
  highlight,
  empty = 'Nothing to show.',
  initialSort,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T, i: number) => string;
  highlight?: (row: T) => boolean;
  empty?: string;
  initialSort?: { key: string; dir: 1 | -1 };
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(initialSort ?? null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const get = col.sort ?? ((r: T) => (r as any)[col.key]);
    return [...rows].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      if (x == null || x === '') return 1;
      if (y == null || y === '') return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir;
    });
  }, [rows, columns, sort]);

  if (!rows.length) return <p className="empty">{empty}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                style={{ textAlign: c.align ?? 'left', width: c.width }}
                onClick={() =>
                  setSort((s) => (s?.key === c.key ? { key: c.key, dir: (s.dir * -1) as 1 | -1 } : { key: c.key, dir: 1 }))
                }
              >
                {c.label}
                {sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={rowKey(r, i)} className={highlight?.(r) ? 'mine' : undefined}>
              {columns.map((c) => (
                <td key={c.key} className={c.wrap ? 'wrap' : undefined} style={{ textAlign: c.align ?? 'left' }}>
                  {c.render ? c.render(r) : fmt((r as any)[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function fmt(v: unknown): ReactNode {
  if (v === null || v === undefined || v === '') return <span className="muted">–</span>;
  if (typeof v === 'number') return v.toLocaleString();
  return String(v);
}

export const money = (n: number | null | undefined) => (n == null ? <span className="muted">–</span> : `$${n.toLocaleString()}`);
export const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export function PlatformBadge({ platform }: { platform: Platform }) {
  const label = { sleeper: 'Sleeper', espn: 'ESPN', mfl: 'MFL' }[platform];
  return <span className={`badge ${platform}`}>{label}</span>;
}

export function PosBadge({ pos }: { pos: string }) {
  return <span className={`pos pos-${pos}`}>{pos}</span>;
}

export function Chips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'chip active' : 'chip'} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Section({ title, children, aside }: { title: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="card">
      <header className="card-head">
        <h2>{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function PageHead({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <div className="page-head">
      <h1>{title}</h1>
      {sub && <p className="muted">{sub}</p>}
    </div>
  );
}

export const POS_FILTER = [
  { value: 'ALL', label: 'All' },
  { value: 'QB', label: 'QB' },
  { value: 'RB', label: 'RB' },
  { value: 'WR', label: 'WR' },
  { value: 'TE', label: 'TE' },
] as const;

export function ago(iso: string | null): string {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleString();
}
