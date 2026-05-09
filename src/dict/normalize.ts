import { RawWordRecord, WordItem } from '../types';

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSentence(item: RawWordRecord): string {
  const fromSentence = normalizeString(item?.sentence);
  if (fromSentence) {
    return fromSentence;
  }
  if (Array.isArray(item?.sentences)) {
    for (const candidate of item.sentences) {
      const text = normalizeString(candidate);
      if (text) {
        return text;
      }
    }
  }
  return '';
}

export function normalizeWordList(raw: unknown): WordItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const dedupe = new Set<string>();
  const result: WordItem[] = [];

  for (const item of raw as RawWordRecord[]) {
    const name = normalizeString(item?.name);
    if (!name) {
      continue;
    }

    const dedupeKey = name.toLowerCase();
    if (dedupe.has(dedupeKey)) {
      continue;
    }
    dedupe.add(dedupeKey);

    result.push({
      name,
      trans: normalizeStringArray(item?.trans),
      e_mean: normalizeStringArray(item?.e_mean),
      usphone: normalizeString(item?.usphone),
      ukphone: normalizeString(item?.ukphone),
      speech: normalizeString(item?.speech),
      sentence: normalizeSentence(item),
    });
  }

  return result;
}
