import fs from 'node:fs/promises';
import path from 'node:path';
import { DictionaryRecord } from '../types';
import { normalizeWordList } from './normalize';

function dictIdFromFileName(fileName: string): string {
  return fileName.replace(/\.json$/i, '');
}

export async function loadDictionaries(dictDir: string): Promise<DictionaryRecord[]> {
  const entries = await fs.readdir(dictDir, { withFileTypes: true });
  const jsonFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const dictionaries: DictionaryRecord[] = [];
  for (const fileName of jsonFiles) {
    const filePath = path.join(dictDir, fileName);
    const content = await fs.readFile(filePath, 'utf8');
    let raw: unknown = [];
    try {
      raw = JSON.parse(content);
    } catch {
      raw = [];
    }

    const words = normalizeWordList(raw);
    dictionaries.push({
      id: dictIdFromFileName(fileName),
      fileName,
      filePath,
      words,
    });
  }

  return dictionaries;
}
