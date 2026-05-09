import fs from 'node:fs/promises';
import https from 'node:https';
import { RawWordRecord } from '../types';

export interface SentenceQueryResult {
  sentence: string;
  source: 'dictionaryapi' | 'fallback';
}

interface DictionaryApiDefinition {
  example?: string;
}

interface DictionaryApiMeaning {
  definitions?: DictionaryApiDefinition[];
}

interface DictionaryApiEntry {
  meanings?: DictionaryApiMeaning[];
}

function requestJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      const statusCode = res.statusCode ?? 0;
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`HTTP ${statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', (error) => reject(error));
    req.setTimeout(5000, () => {
      req.destroy(new Error('request timeout'));
    });
  });
}

function pickExampleSentence(payload: unknown): string {
  if (!Array.isArray(payload)) {
    return '';
  }
  for (const entry of payload as DictionaryApiEntry[]) {
    if (!Array.isArray(entry?.meanings)) continue;
    for (const meaning of entry.meanings) {
      if (!Array.isArray(meaning?.definitions)) continue;
      for (const definition of meaning.definitions) {
        const example = typeof definition?.example === 'string' ? definition.example.trim() : '';
        if (example) {
          return example;
        }
      }
    }
  }
  return '';
}

function fallbackSentence(word: string): string {
  const w = word.trim();
  if (!w) {
    return '';
  }
  return `I am learning the word "${w}" in this session.`;
}

export async function querySentenceForWord(word: string): Promise<SentenceQueryResult> {
  const target = word.trim();
  if (!target) {
    return { sentence: '', source: 'fallback' };
  }

  try {
    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(target)}`;
    const payload = await requestJson(url);
    const sentence = pickExampleSentence(payload);
    if (sentence) {
      return { sentence, source: 'dictionaryapi' };
    }
  } catch {
    // Fallback below.
  }

  return {
    sentence: fallbackSentence(target),
    source: 'fallback',
  };
}

export async function upsertWordSentenceInDict(
  dictFilePath: string,
  word: string,
  sentence: string,
): Promise<boolean> {
  const normalizedWord = word.trim().toLowerCase();
  const normalizedSentence = sentence.trim();
  if (!normalizedWord || !normalizedSentence) {
    return false;
  }

  const raw = await fs.readFile(dictFilePath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    return false;
  }

  let changed = false;
  for (const item of parsed as RawWordRecord[]) {
    const itemName = typeof item?.name === 'string' ? item.name.trim().toLowerCase() : '';
    if (!itemName || itemName !== normalizedWord) {
      continue;
    }
    const current = typeof item.sentence === 'string' ? item.sentence.trim() : '';
    if (current === normalizedSentence) {
      return false;
    }
    item.sentence = normalizedSentence;
    changed = true;
    break;
  }

  if (!changed) {
    return false;
  }

  await fs.writeFile(dictFilePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  return true;
}
