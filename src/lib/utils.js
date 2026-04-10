export const SUBJECT_ORDER = [
  '语文',
  '数学',
  '英语',
  '物理',
  '化学',
  '道法',
  '历史',
  '地理',
  '生物',
  '科学'
];

const SUBJECT_ALIAS_MAP = new Map([
  ['语文', '语文'],
  ['语', '语文'],
  ['数学', '数学'],
  ['数', '数学'],
  ['英语', '英语'],
  ['英', '英语'],
  ['物理', '物理'],
  ['物', '物理'],
  ['化学', '化学'],
  ['化', '化学'],
  ['道法', '道法'],
  ['道德与法治', '道法'],
  ['政治', '道法'],
  ['思想品德', '道法'],
  ['历史', '历史'],
  ['史', '历史'],
  ['地理', '地理'],
  ['地', '地理'],
  ['生物', '生物'],
  ['生', '生物'],
  ['科学', '科学']
]);

export const DEFAULT_PROFILE = Object.freeze({
  name: '本校',
  stage: '初中',
  note: '只保留单校分析、班级比较与教师同学科比较。'
});

export const DEFAULT_METRIC_WEIGHTS = Object.freeze({
  avg: 40,
  excellent: 30,
  pass: 30
});

export function normalizeText(value) {
  return String(value ?? '').trim();
}

export function normalizeLooseText(value) {
  return normalizeText(value).replace(/\s+/g, '').toLowerCase();
}

export function normalizeClass(value) {
  const raw = normalizeText(value).replace(/\s+/g, '');
  if (!raw) return '';
  const match = raw.match(/(\d+)(?:班|class|cls)?$/i);
  if (match) return `${Number(match[1])}班`;
  return raw.replace(/^0+/, '') || raw;
}

export function normalizeSubject(value) {
  const raw = normalizeText(value).replace(/\s+/g, '');
  if (!raw) return '';
  const direct = SUBJECT_ALIAS_MAP.get(raw);
  if (direct) return direct;
  for (const [alias, subject] of SUBJECT_ALIAS_MAP.entries()) {
    if (raw.includes(alias)) return subject;
  }
  return raw;
}

export function sortSubjects(left, right) {
  const leftIndex = SUBJECT_ORDER.indexOf(normalizeSubject(left));
  const rightIndex = SUBJECT_ORDER.indexOf(normalizeSubject(right));
  if (leftIndex !== -1 || rightIndex !== -1) {
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  }
  return String(left || '').localeCompare(String(right || ''), 'zh-Hans-CN');
}

export function toNumber(value, fallback = NaN) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const cleaned = normalizeText(value)
    .replace(/,/g, '')
    .replace(/%$/, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function round(value, digits = 2) {
  const numeric = toNumber(value, NaN);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

export function formatNumber(value, digits = 1) {
  return round(value, digits).toFixed(digits);
}

export function formatPercent(value, digits = 1) {
  return `${round((toNumber(value, 0) || 0) * 100, digits).toFixed(digits)}%`;
}

export function computeRate(hitCount, totalCount) {
  if (!totalCount) return 0;
  return hitCount / totalCount;
}

export function inferFullMark(maxScore) {
  const score = Math.max(0, toNumber(maxScore, 0));
  const candidates = [20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 150];
  return candidates.find((candidate) => candidate >= score) || Math.ceil(score / 10) * 10 || 100;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    '\'': '&#39;'
  }[char]));
}

export function uid(prefix = 'id') {
  const seed = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${seed}`;
}

export function slugify(value) {
  return normalizeLooseText(value).replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '') || uid('slug');
}

export function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

export function dedupeRows(rows, keyBuilder) {
  const map = new Map();
  (rows || []).forEach((row) => {
    const key = keyBuilder(row);
    if (!key) return;
    map.set(key, row);
  });
  return [...map.values()];
}

export function sortAndRank(rows, selector) {
  const sorted = [...rows].sort((left, right) => selector(right) - selector(left));
  let lastScore = null;
  let lastRank = 0;
  return sorted.map((row, index) => {
    const score = selector(row);
    if (lastScore === null || Math.abs(score - lastScore) > 0.0001) {
      lastRank = index + 1;
      lastScore = score;
    }
    return { ...row, rank: lastRank };
  });
}

export function buildClassSubjectKey(className, subject) {
  const normalizedClass = normalizeClass(className);
  const normalizedSubject = normalizeSubject(subject);
  return normalizedClass && normalizedSubject ? `${normalizedClass}__${normalizedSubject}` : '';
}

export function csvFromMatrix(matrix) {
  return (matrix || [])
    .map((row) => row.map((cell) => {
      const text = String(cell ?? '');
      const escaped = text.replace(/"/g, '""');
      return /[",\n]/.test(text) ? `"${escaped}"` : escaped;
    }).join(','))
    .join('\n');
}

export function downloadTextFile(filename, text, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
