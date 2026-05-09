import { Stage, WordItem, WordProgress } from '../types';

function isDue(progress: WordProgress, now: number): boolean {
  return progress.nextSpellingAt <= now || progress.nextMeaningAt <= now;
}

function pickFirst(candidates: number[]): number | null {
  return candidates.length > 0 ? candidates[0] : null;
}

function stageIn(stage: Stage, list: Stage[]): boolean {
  return list.includes(stage);
}

export function pickNextWordIndex(
  words: WordItem[],
  progressByWord: Map<string, WordProgress>,
  now: number,
  fallbackCursor: number,
): number {
  if (words.length === 0) {
    return -1;
  }

  const dueLearning: number[] = [];
  const dueReviewing: number[] = [];
  const newWords: number[] = [];
  const dueMature: number[] = [];
  const otherDue: number[] = [];

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const progress = progressByWord.get(word.name.toLowerCase()) ?? {
      word: word.name,
      dict: '',
      stage: 'new' as const,
      spellingLevel: 0,
      meaningLevel: 0,
      nextSpellingAt: 0,
      nextMeaningAt: 0,
      wrongCount: 0,
      consecutiveCorrect: 0,
      reviewCount: 0,
    };

    if (progress.stage === 'new') {
      newWords.push(i);
      continue;
    }

    if (!isDue(progress, now)) {
      continue;
    }

    if (stageIn(progress.stage, ['learning', 'encoding', 'leech'])) {
      dueLearning.push(i);
      continue;
    }

    if (progress.stage === 'reviewing') {
      dueReviewing.push(i);
      continue;
    }

    if (progress.stage === 'mature') {
      dueMature.push(i);
      continue;
    }

    otherDue.push(i);
  }

  return (
    pickFirst(dueLearning) ??
    pickFirst(dueReviewing) ??
    pickFirst(newWords) ??
    pickFirst(dueMature) ??
    pickFirst(otherDue) ??
    fallbackCursor % words.length
  );
}
