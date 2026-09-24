// Player-name matching across platforms. Every source spells names a little differently
// ("Amon-Ra St. Brown", "St. Brown, Amon-Ra", "James Cook III"), so all matching goes
// through normalizeName().

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

/** Nicknames and spellings that differ between sources, applied after normalizing. */
const ALIASES: Record<string, string> = {
  'hollywood brown': 'marquise brown',
  'gabe davis': 'gabriel davis',
  'chig okonkwo': 'chigoziem okonkwo',
  'josh palmer': 'joshua palmer',
  'tank dell': 'nathaniel dell',
  'cam ward': 'cameron ward',
};

export function normalizeName(raw: string): string {
  let name = raw.trim();
  // MFL uses "Last, First".
  const comma = name.indexOf(',');
  if (comma > 0) name = `${name.slice(comma + 1)} ${name.slice(0, comma)}`;
  const words = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.'’`-]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 2 && SUFFIXES.has(words[words.length - 1])) words.pop();
  const key = words.join(' ');
  return ALIASES[key] ?? key;
}

/** "Collins, Nico" -> "Nico Collins". */
export function displayName(raw: string): string {
  const comma = raw.indexOf(',');
  return comma > 0 ? `${raw.slice(comma + 1).trim()} ${raw.slice(0, comma).trim()}` : raw.trim();
}

/**
 * Dynasty trade value derived from the FantasyPros overall rank: 10,000 for #1,
 * decaying exponentially (the same curve the spreadsheet used).
 */
export function dynastyValue(rank: number | undefined): number {
  if (!rank || rank < 1) return 0;
  return Math.round(10000 * Math.exp(-(rank - 1) / 75));
}

/** Position without a trailing positional rank: "WR12" -> "WR", "DST" stays "DST". */
export function basePosition(pos: string): string {
  return pos.replace(/\d+$/, '').toUpperCase();
}
