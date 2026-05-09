import path from 'node:path';
import { loadDictionaries } from '../dict/loader';
import { querySentenceForWord, upsertWordSentenceInDict } from '../dict/sentence-service';

async function main(): Promise<void> {
  const [, , dictId, word] = process.argv;
  if (!dictId || !word) {
    // eslint-disable-next-line no-console
    console.log('Usage: pnpm run sentence:add -- <dictId> <word>');
    process.exit(1);
  }

  const rootDir = path.resolve(process.cwd());
  const dictDir = path.join(rootDir, 'json');
  const dictionaries = await loadDictionaries(dictDir);
  const dict = dictionaries.find((item) => item.id === dictId);
  if (!dict) {
    // eslint-disable-next-line no-console
    console.log(`Dictionary not found: ${dictId}`);
    process.exit(1);
  }

  const queried = await querySentenceForWord(word);
  if (!queried.sentence) {
    // eslint-disable-next-line no-console
    console.log(`No sentence found for: ${word}`);
    process.exit(1);
  }

  const changed = await upsertWordSentenceInDict(dict.filePath, word, queried.sentence);
  if (!changed) {
    // eslint-disable-next-line no-console
    console.log(`No update needed for ${word} in ${dictId}`);
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`Updated ${dictId}:${word}`);
  // eslint-disable-next-line no-console
  console.log(`Source: ${queried.source}`);
  // eslint-disable-next-line no-console
  console.log(`Sentence: ${queried.sentence}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
