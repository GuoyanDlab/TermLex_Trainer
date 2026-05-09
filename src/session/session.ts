import { pickNextWordIndex } from '../progress/scheduler';
import { ProgressStore } from '../progress/progress-store';
import {
  Rating,
  SessionMode,
  SessionTask,
  TaskViewModel,
  WordItem,
  WordProgress,
} from '../types';
import { createTask } from './task';
import { evaluateTyping, renderTypingComparison } from './typing-engine';

const DAY_MS = 24 * 60 * 60 * 1000;
const LEVEL_INTERVAL_DAYS = [1, 2, 4, 7, 15, 30, 60];

function intervalByLevel(level: number): number {
  const index = Math.max(0, Math.min(LEVEL_INTERVAL_DAYS.length - 1, level));
  return LEVEL_INTERVAL_DAYS[index] * DAY_MS;
}

function formatArray(items: string[], fallback: string): string {
  if (items.length === 0) {
    return fallback;
  }
  return items.join(' | ');
}

function hiddenWord(word: string): string {
  return '_'.repeat(Math.max(1, word.length));
}

export class TrainingSession {
  private dictId = '';
  private words: WordItem[] = [];
  private currentWordIndex = -1;
  private fallbackCursor = 0;
  private currentWord: WordItem | null = null;
  private currentProgress: WordProgress | null = null;
  private task: SessionTask | null = null;
  private reviewedCount = 0;

  constructor(private readonly progressStore: ProgressStore) {}

  setDictionary(dictId: string, words: WordItem[]): void {
    this.dictId = dictId;
    this.words = words;
    this.currentWordIndex = -1;
    this.fallbackCursor = 0;
    this.reviewedCount = 0;
    this.currentWord = null;
    this.currentProgress = null;
    this.task = null;
    this.nextWord();
  }

  getCurrentWordName(): string {
    return this.currentWord?.name ?? '';
  }

  getCurrentSentence(): string {
    return this.currentWord?.sentence?.trim() ?? '';
  }

  getCurrentMode(): SessionMode {
    return this.task?.mode ?? 'typing';
  }

  shouldAutoPlay(): boolean {
    if (!this.task) return false;
    if (this.task.type === 'copy_typing' && this.task.mode === 'typing') return true;
    if (this.task.type === 'meaning_to_word' && this.task.mode === 'typing') return true;
    if (this.task.type === 'word_to_meaning' && this.task.mode === 'meaning') return true;
    return false;
  }

  getAutoPlayInfo(): { key: string; word: string } | null {
    if (!this.currentWord || !this.task) return null;
    if (!this.shouldAutoPlay()) return null;
    const key = [
      this.dictId,
      this.currentWord.name.toLowerCase(),
      this.task.type,
      this.task.mode,
      this.task.stage,
      this.task.repeatDone,
      this.task.meaningSubmitted ? '1' : '0',
      this.currentWordIndex,
    ].join('::');
    return { key, word: this.currentWord.name };
  }

  isLeechTask(): boolean {
    return this.task?.stage === 'leech';
  }

  nextWord(): void {
    if (this.words.length === 0) {
      this.currentWord = null;
      this.currentProgress = null;
      this.task = null;
      return;
    }

    const now = Date.now();
    const progressByWord = this.progressStore.listByDict(this.dictId);

    const nextIndex = pickNextWordIndex(this.words, progressByWord, now, this.fallbackCursor);
    this.currentWordIndex = nextIndex;
    this.fallbackCursor = (nextIndex + 1) % this.words.length;
    this.currentWord = this.words[nextIndex];
    this.currentProgress = this.progressStore.getOrCreate(this.dictId, this.currentWord.name);
    this.task = createTask(this.currentProgress, this.currentWord);
  }

  handlePrintable(input: string): void {
    if (!this.task || !this.currentWord) return;
    if (input.length !== 1) return;
    if (this.task.mode === 'rating') return;

    this.task.notice = '';
    this.task.input += input;

    if (this.task.mode === 'typing') {
      const result = evaluateTyping(this.currentWord.name, this.task.input);
      if (result.isComplete) {
        this.finalizeTypingRound();
      }
    }
  }

  handleBackspace(): void {
    if (!this.task) return;
    if (this.task.mode === 'rating') return;
    this.task.input = this.task.input.slice(0, -1);
  }

  handleEnter(): void {
    if (!this.task) return;
    if (this.task.mode === 'typing') {
      const target = this.currentWord?.name ?? '';
      if (this.task.input.length >= target.length) {
        this.finalizeTypingRound();
      }
      return;
    }
    if (this.task.mode === 'meaning') {
      this.submitMeaningAnswer();
    }
  }

  private finalizeTypingRound(): void {
    if (!this.task || !this.currentWord || !this.currentProgress) return;
    const result = evaluateTyping(this.currentWord.name, this.task.input);
    if (result.hasError) {
      this.task.wrongRounds += 1;
      this.task.lastTypingHadError = true;
      this.currentProgress.wrongCount += 1;
      if (this.currentProgress.wrongCount >= 5) {
        this.currentProgress.stage = 'leech';
        this.task.stage = 'leech';
      }
      this.progressStore.touch(this.currentProgress);
      void this.progressStore.save();
    } else {
      this.task.repeatDone += 1;
      this.task.lastTypingHadError = false;
    }
    this.task.input = '';

    if (this.task.repeatDone >= this.task.repeatTarget) {
      this.onTypingTargetReached();
    }
  }

  private onTypingTargetReached(): void {
    if (!this.task) return;
    if (this.task.followup === 'word_to_meaning') {
      this.task.type = 'word_to_meaning';
      this.task.mode = 'meaning';
      this.task.followup = 'rating';
      this.task.input = '';
      this.task.notice = '';
      this.task.meaningSubmitted = false;
      return;
    }
    this.task.mode = 'rating';
  }

  private submitMeaningAnswer(): void {
    if (!this.task) return;
    this.task.meaningAnswer = this.task.input.trim();
    this.task.meaningSubmitted = true;
    this.task.input = '';
    this.task.mode = 'rating';
  }

  applyRating(rating: Rating): void {
    if (!this.task || !this.currentProgress) return;
    if (this.task.mode !== 'rating') return;

    const now = Date.now();
    const progress = this.currentProgress;
    progress.lastReviewedAt = now;

    if (rating === 'again') {
      progress.stage = 'learning';
      progress.spellingLevel = Math.max(0, progress.spellingLevel - 1);
      progress.meaningLevel = Math.max(0, progress.meaningLevel - 1);
      progress.wrongCount += 1;
      progress.consecutiveCorrect = 0;
      progress.nextSpellingAt = now + 5 * 60 * 1000;
      progress.nextMeaningAt = now + 5 * 60 * 1000;
    } else if (rating === 'hard') {
      progress.consecutiveCorrect = 0;
      progress.nextSpellingAt = now + 30 * 60 * 1000;
      progress.nextMeaningAt = now + 30 * 60 * 1000;
    } else {
      progress.consecutiveCorrect += 1;
      progress.reviewCount += 1;

      if (progress.stage === 'new') {
        progress.stage = 'encoding';
      } else if (progress.stage === 'encoding' && progress.consecutiveCorrect >= 2) {
        progress.stage = 'learning';
      } else if (progress.stage === 'learning' && progress.consecutiveCorrect >= 3) {
        progress.stage = 'reviewing';
      } else if (progress.stage === 'reviewing' && progress.consecutiveCorrect >= 5) {
        progress.stage = 'mature';
      }

      progress.spellingLevel += 1;
      progress.meaningLevel += 1;
      progress.nextSpellingAt = now + intervalByLevel(progress.spellingLevel);
      progress.nextMeaningAt = now + intervalByLevel(progress.meaningLevel);
    }

    if (progress.wrongCount >= 5) {
      progress.stage = 'leech';
    }

    this.progressStore.touch(progress);
    void this.progressStore.save();
    this.reviewedCount += 1;
    this.nextWord();
  }

  markGeminiNotice(): void {
    if (!this.task) return;
    this.task.notice = 'Gemini not implemented';
  }

  setTaskNotice(notice: string): void {
    if (!this.task) return;
    this.task.notice = notice;
  }

  getViewModel(): TaskViewModel {
    const word = this.currentWord;
    const progress = this.currentProgress;
    const task = this.task;

    if (!word || !progress || !task) {
      return {
        dictId: this.dictId,
        wordIndex: 0,
        wordTotal: this.words.length,
        stage: 'new',
        taskType: 'copy_typing',
        mode: 'typing',
        repeatDone: 0,
        repeatTarget: 0,
        wrongRounds: 0,
        prompt: this.words.length === 0 ? 'No words in dictionary' : 'Preparing...',
        wordDisplay: '',
        inputDisplay: '',
        typingDisplay: '',
        translationDisplay: 'No translation',
        englishMeaningDisplay: 'No English meaning',
        speechDisplay: '',
        sentenceDisplay: 'No sentence',
        phoneDisplay: '',
        meaningAnswerDisplay: '',
        ratingHint: '',
        notice: '',
      };
    }

    const translationDisplay = formatArray(word.trans, 'No translation');
    const englishMeaningDisplay = formatArray(word.e_mean, 'No English meaning');
    const sentenceDisplay = word.sentence || 'No sentence';
    const wordDisplay = task.type === 'meaning_to_word' && task.mode === 'typing' ? hiddenWord(word.name) : word.name;
    const prompt =
      task.type === 'copy_typing'
        ? 'Copy typing: input the word exactly'
        : task.type === 'meaning_to_word'
          ? 'Meaning to word: type the English word from Chinese meaning'
          : 'Word to meaning: input Chinese meaning then self-rate';

    const typingDisplay =
      task.mode === 'typing'
        ? renderTypingComparison(word.name, task.input)
        : task.mode === 'meaning'
          ? task.input || ''
          : task.meaningSubmitted
            ? `Your answer: ${task.meaningAnswer || '(empty)'}`
            : '';

    const meaningAnswerDisplay =
      task.mode === 'rating' && task.meaningSubmitted
        ? `Reference: ${translationDisplay}`
        : '';

    const phoneDisplay = `US: ${word.usphone || '-'} | UK: ${word.ukphone || '-'}`;

    return {
      dictId: this.dictId,
      wordIndex: this.currentWordIndex + 1,
      wordTotal: this.words.length,
      stage: task.stage,
      taskType: task.type,
      mode: task.mode,
      repeatDone: task.repeatDone,
      repeatTarget: task.repeatTarget,
      wrongRounds: task.wrongRounds,
      prompt,
      wordDisplay,
      inputDisplay: task.input,
      typingDisplay,
      translationDisplay,
      englishMeaningDisplay,
      speechDisplay: word.speech || '-',
      sentenceDisplay,
      phoneDisplay,
      meaningAnswerDisplay,
      ratingHint:
        'a again | s hard | d good | e ElevenLabs cycle | f sentence | t translate | Ctrl+Y Word YouGlish | Ctrl+O Chunk Radio',
      notice: task.notice || '',
    };
  }
}
