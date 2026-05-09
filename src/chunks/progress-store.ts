import fs from 'node:fs/promises';
import path from 'node:path';

export interface ChunkProgressFile {
  version: number;
  source: string;
  lastChunkIndex: number;
  lastChunkText: string;
  updatedAt: number;
}

const DEFAULT_PROGRESS: ChunkProgressFile = {
  version: 1,
  source: 'chunks/chunks.json',
  lastChunkIndex: 0,
  lastChunkText: '',
  updatedAt: 0,
};

function sanitizeIndex(raw: unknown, totalChunks: number): number {
  if (totalChunks <= 0) {
    return 0;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  const normalized = Math.floor(parsed);
  if (normalized < 0) {
    return 0;
  }
  if (normalized > totalChunks - 1) {
    return totalChunks - 1;
  }
  return normalized;
}

export class ChunkProgressStore {
  private state: ChunkProgressFile = { ...DEFAULT_PROGRESS };
  private initialized = false;

  constructor(
    private readonly filePath: string,
    private readonly source = 'chunks/chunks.json',
  ) {}

  async init(totalChunks: number): Promise<void> {
    if (this.initialized) {
      this.state.lastChunkIndex = sanitizeIndex(this.state.lastChunkIndex, totalChunks);
      return;
    }

    const next: ChunkProgressFile = { ...DEFAULT_PROGRESS, source: this.source };
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Partial<ChunkProgressFile>;
        next.version = typeof obj.version === 'number' ? obj.version : 1;
        next.source = typeof obj.source === 'string' && obj.source ? obj.source : this.source;
        next.lastChunkIndex = sanitizeIndex(obj.lastChunkIndex, totalChunks);
        next.lastChunkText = typeof obj.lastChunkText === 'string' ? obj.lastChunkText : '';
        next.updatedAt = typeof obj.updatedAt === 'number' ? obj.updatedAt : 0;
      }
    } catch {
      // keep defaults when file is missing or invalid
    }
    this.state = next;
    this.initialized = true;
  }

  getLastChunkIndex(totalChunks: number): number {
    return sanitizeIndex(this.state.lastChunkIndex, totalChunks);
  }

  async saveCurrent(index: number, chunks: string[]): Promise<void> {
    const totalChunks = chunks.length;
    const normalizedIndex = sanitizeIndex(index, totalChunks);
    const payload: ChunkProgressFile = {
      version: 1,
      source: this.source,
      lastChunkIndex: normalizedIndex,
      lastChunkText: chunks[normalizedIndex] ?? '',
      updatedAt: Date.now(),
    };
    this.state = payload;

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(payload, null, 2), 'utf-8');
  }
}
