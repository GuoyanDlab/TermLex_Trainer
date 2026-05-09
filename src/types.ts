export type Stage =
  | 'new'
  | 'encoding'
  | 'learning'
  | 'reviewing'
  | 'mature'
  | 'leech';

export type TaskType =
  | 'copy_typing'
  | 'meaning_to_word'
  | 'word_to_meaning'
  | 'choice'
  | 'dictation'
  | 'exam';

export type Rating = 'again' | 'hard' | 'good';

export interface RawWordRecord {
  name?: unknown;
  trans?: unknown;
  usphone?: unknown;
  ukphone?: unknown;
  e_mean?: unknown;
  speech?: unknown;
  sentence?: unknown;
  sentences?: unknown;
}

export interface WordItem {
  name: string;
  trans: string[];
  usphone: string;
  ukphone: string;
  e_mean: string[];
  speech: string;
  sentence: string;
}

export interface DictionaryRecord {
  id: string;
  fileName: string;
  filePath: string;
  words: WordItem[];
}

export interface WordProgress {
  word: string;
  dict: string;
  stage: Stage;
  spellingLevel: number;
  meaningLevel: number;
  nextSpellingAt: number;
  nextMeaningAt: number;
  wrongCount: number;
  consecutiveCorrect: number;
  reviewCount: number;
  lastReviewedAt?: number;
}

export interface ProgressFile {
  version: number;
  updatedAt: number;
  items: WordProgress[];
}

export type SessionMode = 'typing' | 'meaning' | 'rating';

export interface SessionTask {
  type: TaskType;
  stage: Stage;
  repeatTarget: number;
  repeatDone: number;
  wrongRounds: number;
  input: string;
  mode: SessionMode;
  followup: 'none' | 'word_to_meaning' | 'rating';
  meaningAnswer?: string;
  meaningSubmitted?: boolean;
  lastTypingHadError: boolean;
  notice?: string;
}

export interface TaskViewModel {
  dictId: string;
  wordIndex: number;
  wordTotal: number;
  stage: Stage;
  taskType: TaskType;
  mode: SessionMode;
  repeatDone: number;
  repeatTarget: number;
  wrongRounds: number;
  prompt: string;
  wordDisplay: string;
  inputDisplay: string;
  typingDisplay: string;
  translationDisplay: string;
  englishMeaningDisplay: string;
  speechDisplay: string;
  sentenceDisplay: string;
  phoneDisplay: string;
  meaningAnswerDisplay: string;
  ratingHint: string;
  notice: string;
}
