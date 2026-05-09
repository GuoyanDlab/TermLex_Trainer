import fs from 'node:fs/promises';

function normalizeChunk(raw: unknown): string {
  if (typeof raw !== 'string') {
    return '';
  }
  return raw.replace(/\s+/g, ' ').trim();
}

export async function loadChunks(filePath: string): Promise<string[]> {
  const raw = await fs.readFile(filePath, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Invalid chunks json: expected array in ${filePath}`);
  }

  const seen = new Set<string>();
  const chunks: string[] = [];
  for (const item of parsed) {
    const chunk = normalizeChunk(item);
    if (!chunk) {
      continue;
    }
    const key = chunk.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    chunks.push(chunk);
  }
  return chunks;
}
