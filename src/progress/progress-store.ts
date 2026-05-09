import fs from 'node:fs/promises';
import path from 'node:path';
import { ProgressFile, WordProgress } from '../types';

const DEFAULT_PROGRESS: Omit<WordProgress, 'word' | 'dict'> = {
  stage: 'new',
  spellingLevel: 0,
  meaningLevel: 0,
  nextSpellingAt: 0,
  nextMeaningAt: 0,
  wrongCount: 0,
  consecutiveCorrect: 0,
  reviewCount: 0,
  lastReviewedAt: 0,
};

function progressKey(dict: string, word: string): string {
  return `${dict}::${word.toLowerCase()}`;
}

export class ProgressStore {
  private readonly filePath: string;
  private readonly map = new Map<string, WordProgress>();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as ProgressFile;
      if (!parsed || !Array.isArray(parsed.items)) {
        return;
      }

      for (const item of parsed.items) {
        if (!item?.dict || !item?.word) {
          continue;
        }
        this.map.set(progressKey(item.dict, item.word), item);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        await this.save();
      } else {
        throw error;
      }
    }
  }

  getOrCreate(dict: string, word: string): WordProgress {
    const key = progressKey(dict, word);
    const existing = this.map.get(key);
    if (existing) {
      return existing;
    }

    const created: WordProgress = {
      ...DEFAULT_PROGRESS,
      dict,
      word,
    };
    this.map.set(key, created);
    return created;
  }

  listByDict(dict: string): Map<string, WordProgress> {
    const result = new Map<string, WordProgress>();
    for (const item of this.map.values()) {
      if (item.dict === dict) {
        result.set(item.word.toLowerCase(), item);
      }
    }
    return result;
  }

  touch(progress: WordProgress): void {
    this.map.set(progressKey(progress.dict, progress.word), progress);
  }

  async save(): Promise<void> {
    const payload: ProgressFile = {
      version: 1,
      updatedAt: Date.now(),
      items: [...this.map.values()],
    };
    await fs.writeFile(this.filePath, JSON.stringify(payload, null, 2), 'utf8');
  }
}
