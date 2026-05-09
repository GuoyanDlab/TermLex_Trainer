import path from 'node:path';
import blessed from 'neo-blessed';
import { VoicePlayer } from './audio/voice-player';
import { loadChunks } from './chunks/loader';
import { ChunkProgressStore } from './chunks/progress-store';
import { loadDictionaries } from './dict/loader';
import { querySentenceForWord, upsertWordSentenceInDict } from './dict/sentence-service';
import { translateSentenceToChinese } from './dict/translation-service';
import { ProgressStore } from './progress/progress-store';
import { TrainingSession } from './session/session';
import { YouGlishBridge, YouGlishSnapshot } from './youglish/bridge';
import { createLayout } from './ui/layout';
import { isDownKey, isPrintableChar, isUpKey } from './ui/keybindings';
import { renderDataset, renderStatus, renderTask, renderYouGlish } from './ui/renderer';
import { createScreen } from './ui/screen';
import { DictionaryRecord } from './types';

type FocusSide = 'dataset' | 'task';
type YouGlishMode = 'word' | 'chunks';

interface YouGlishOverlayState {
  visible: boolean;
  mode: YouGlishMode;
  query: string;
  clipIndex: number;
  totalClips: number;
  consumedCount: number;
  speed: number;
  autoNextGapMs: number;
  phrase: string;
  phraseTranslation: string;
  playerState: string;
  videoId: string;
  message: string;
  error: string;
}

interface ChunkRadioState {
  chunks: string[];
  currentIndex: number;
  activeStartConsumed: number;
  activeTarget: number;
  switching: boolean;
  jumpInputMode: boolean;
  jumpInput: string;
  touched: boolean;
}

export class App {
  private readonly dictDir: string;
  private readonly chunksPath: string;
  private readonly chunksProgressPath: string;
  private readonly progressPath: string;
  private readonly audioDir: string;
  private readonly progressStore: ProgressStore;
  private readonly chunkProgressStore: ChunkProgressStore;
  private readonly voicePlayer: VoicePlayer;
  private readonly session: TrainingSession;
  private readonly youglishBridge: YouGlishBridge;

  private dictionaries: DictionaryRecord[] = [];
  private visibleIndexes: number[] = [];
  private selectedVisibleIndex = 0;
  private focus: FocusSide = 'dataset';
  private searchMode = false;
  private searchTerm = '';
  private lastAutoPlaySuccessKey = '';
  private lastAutoPlayAttemptKey = '';
  private lastAutoPlayAttemptAt = 0;
  private autoPlayTicker: NodeJS.Timeout | null = null;
  private runtimeNotice = '';
  private stopping = false;
  private youglishPoller: NodeJS.Timeout | null = null;
  private lastYouglishCaptionId = 0;
  private youglishTranslateToken = 0;
  private youglishRecovering = false;
  private lastYouglishRecoverAt = 0;
  private youglishTranslationCache = new Map<string, string>();
  private youglishState: YouGlishOverlayState = {
    visible: false,
    mode: 'word',
    query: '',
    clipIndex: 0,
    totalClips: 0,
    consumedCount: 0,
    speed: 1,
    autoNextGapMs: 900,
    phrase: '',
    phraseTranslation: '',
    playerState: 'unknown',
    videoId: '',
    message: 'idle',
    error: '',
  };
  private chunkRadioState: ChunkRadioState = {
    chunks: [],
    currentIndex: 0,
    activeStartConsumed: 0,
    activeTarget: 20,
    switching: false,
    jumpInputMode: false,
    jumpInput: '',
    touched: false,
  };

  private readonly screen = createScreen();
  private readonly layout = createLayout(this.screen);

  constructor(private readonly rootDir: string) {
    this.dictDir = path.join(rootDir, 'json');
    this.chunksPath = path.join(rootDir, 'chunks', 'chunks.json');
    this.chunksProgressPath = path.join(rootDir, 'data', 'chunks-progress.json');
    this.progressPath = path.join(rootDir, 'data', 'progress.json');
    this.audioDir = path.join(rootDir, 'data', 'audio');
    this.progressStore = new ProgressStore(this.progressPath);
    this.chunkProgressStore = new ChunkProgressStore(this.chunksProgressPath, 'chunks/chunks.json');
    this.voicePlayer = new VoicePlayer(this.audioDir);
    this.session = new TrainingSession(this.progressStore);
    this.youglishBridge = new YouGlishBridge(path.join(rootDir, 'data', 'youglish'));
  }

  async init(): Promise<void> {
    await this.progressStore.init();
    await this.voicePlayer.init();
    this.dictionaries = await loadDictionaries(this.dictDir);
    await this.loadChunkRadioState();
    this.applySearchFilter();
    this.selectDictionaryByVisibleIndex(0);
    if (!(process.env.ELEVENLABS_API_KEY || '').trim()) {
      this.runtimeNotice = 'ELEVENLABS_API_KEY not set; e will fallback to macOS say';
    }
    this.bindKeys();
    this.render();
    this.maybeAutoPlay();
    this.startAutoPlayTicker();
  }

  private startAutoPlayTicker(): void {
    if (this.autoPlayTicker) {
      clearInterval(this.autoPlayTicker);
      this.autoPlayTicker = null;
    }
    this.autoPlayTicker = setInterval(() => {
      if (this.stopping) {
        return;
      }
      this.maybeAutoPlay();
    }, 1200);
  }

  private async loadChunkRadioState(): Promise<void> {
    try {
      const chunks = await loadChunks(this.chunksPath);
      this.chunkRadioState.chunks = chunks;
      await this.chunkProgressStore.init(chunks.length);
      this.chunkRadioState.currentIndex = this.chunkProgressStore.getLastChunkIndex(chunks.length);
    } catch (error) {
      this.chunkRadioState.chunks = [];
      this.chunkRadioState.currentIndex = 0;
      this.runtimeNotice = `Load chunks failed: ${(error as Error).message}`;
    }
  }

  private getCurrentDictionary(): DictionaryRecord | null {
    const actual = this.visibleIndexes[this.selectedVisibleIndex];
    if (actual === undefined) {
      return null;
    }
    return this.dictionaries[actual] ?? null;
  }

  private applySearchFilter(): void {
    const term = this.searchTerm.trim().toLowerCase();
    this.visibleIndexes = [];
    for (let i = 0; i < this.dictionaries.length; i += 1) {
      const dict = this.dictionaries[i];
      if (!term || dict.id.toLowerCase().includes(term)) {
        this.visibleIndexes.push(i);
      }
    }
    if (this.visibleIndexes.length === 0) {
      this.selectedVisibleIndex = 0;
    } else if (this.selectedVisibleIndex > this.visibleIndexes.length - 1) {
      this.selectedVisibleIndex = this.visibleIndexes.length - 1;
    }
  }

  private selectDictionaryByVisibleIndex(visibleIndex: number): void {
    if (this.visibleIndexes.length === 0) {
      this.session.setDictionary('', []);
      return;
    }
    this.selectedVisibleIndex = Math.max(0, Math.min(visibleIndex, this.visibleIndexes.length - 1));
    const dict = this.getCurrentDictionary();
    if (!dict) {
      this.session.setDictionary('', []);
      return;
    }
    this.session.setDictionary(dict.id, dict.words);
    this.lastAutoPlaySuccessKey = '';
    this.lastAutoPlayAttemptKey = '';
    this.lastAutoPlayAttemptAt = 0;
  }

  private bindKeys(): void {
    this.screen.on('keypress', (ch, key) => {
      void this.handleKeypress(ch, key);
    });

    this.screen.on('resize', () => {
      this.render();
    });
  }

  private async handleKeypress(
    ch: string | undefined,
    key: blessed.Widgets.Events.IKeyEventArg,
  ): Promise<void> {
    const lowerCh = (ch || '').toLowerCase();
    const lowerName = (key.name || '').toLowerCase();
    const lowerFull = (key.full || '').toLowerCase();
    const inTaskInputMode =
      !this.searchMode &&
      this.focus === 'task' &&
      (this.session.getCurrentMode() === 'typing' || this.session.getCurrentMode() === 'meaning');

    const quitHotkey = ch === 'Q' || key.full === 'S-q' || key.full === 'C-c';
    const reloadHotkey = ch === 'R' || key.full === 'S-r';
    const addSentenceHotkey = key.full === 'C-e';
    const replayHotkey = ch === 'P' || key.full === 'S-p';
    const muteHotkey = ch === 'M' || key.full === 'S-m';
    const accentHotkey = ch === 'U' || key.full === 'S-u';
    const youglishChunkToggleHotkey = lowerFull === 'c-o';
    const youglishToggleHotkey = key.full === 'C-y' || (!inTaskInputMode && lowerCh === 'y');

    if (quitHotkey || (!inTaskInputMode && ch === 'q')) {
      await this.shutdown();
      return;
    }

    if (this.youglishState.visible) {
      if (youglishToggleHotkey || youglishChunkToggleHotkey || key.name === 'escape') {
        await this.closeYouGlishOverlay();
        this.render();
        return;
      }
      const handled = await this.handleYouGlishOverlayKey(ch, key);
      if (handled) {
        this.render();
        return;
      }
      this.render();
      return;
    } else if (youglishChunkToggleHotkey) {
      await this.openYouGlishChunkRadio();
      this.render();
      return;
    } else if (youglishToggleHotkey) {
      await this.openYouGlishForCurrentWord();
      this.render();
      return;
    }

    if (key.name === 'tab') {
      this.focus = this.focus === 'dataset' ? 'task' : 'dataset';
      this.render();
      return;
    }

    if (reloadHotkey || (!inTaskInputMode && ch === 'r')) {
      await this.reloadCurrentDictionary();
      return;
    }

    if (addSentenceHotkey) {
      await this.addSentenceToCurrentWord();
      return;
    }

    if (!inTaskInputMode && ch === 'p') {
      await this.replayCurrentWord();
      return;
    }

    if (!inTaskInputMode && ch === 'm') {
      this.voicePlayer.toggleMute();
      this.render();
      return;
    }

    if (!inTaskInputMode && ch === 'u') {
      this.voicePlayer.toggleAccent();
      this.render();
      return;
    }

    if (replayHotkey) {
      await this.replayCurrentWord();
      return;
    }

    if (muteHotkey) {
      this.voicePlayer.toggleMute();
      this.render();
      return;
    }

    if (accentHotkey) {
      this.voicePlayer.toggleAccent();
      this.render();
      return;
    }

    if (this.searchMode) {
      this.handleSearchModeKey(ch, key);
      this.render();
      return;
    }

    // Rating keys should still work even when dataset panel has focus.
    if (this.session.getCurrentMode() === 'rating') {
      const isRatingActionKey =
        ['a', 's', 'd', 'f', 'e', 't'].includes(lowerCh) ||
        ['a', 's', 'd', 'f', 'e', 't'].includes(lowerName) ||
        ['a', 's', 'd', 'f', 'e', 't', 's-g'].includes(lowerFull);
      if (isRatingActionKey) {
        this.handleTaskKey(ch, key);
        this.render();
        return;
      }
    }

    if (this.focus === 'dataset') {
      this.handleDatasetKey(ch, key);
    } else {
      this.handleTaskKey(ch, key);
    }

    this.render();
    this.maybeAutoPlay();
  }

  private handleSearchModeKey(ch: string | undefined, key: blessed.Widgets.Events.IKeyEventArg): void {
    if (key.name === 'escape') {
      this.searchMode = false;
      this.searchTerm = '';
      this.applySearchFilter();
      this.selectDictionaryByVisibleIndex(0);
      return;
    }

    if (key.name === 'enter') {
      this.searchMode = false;
      if (this.visibleIndexes.length > 0) {
        this.selectDictionaryByVisibleIndex(this.selectedVisibleIndex);
      }
      return;
    }

    if (key.name === 'backspace') {
      this.searchTerm = this.searchTerm.slice(0, -1);
      this.applySearchFilter();
      this.selectedVisibleIndex = 0;
      return;
    }

    if (isPrintableChar(ch)) {
      this.searchTerm += ch;
      this.applySearchFilter();
      this.selectedVisibleIndex = 0;
    }
  }

  private handleDatasetKey(ch: string | undefined, key: blessed.Widgets.Events.IKeyEventArg): void {
    if (ch === '/') {
      this.searchMode = true;
      return;
    }

    if (isDownKey(ch, key)) {
      if (this.visibleIndexes.length > 0) {
        this.selectedVisibleIndex = Math.min(this.visibleIndexes.length - 1, this.selectedVisibleIndex + 1);
      }
      return;
    }

    if (isUpKey(ch, key)) {
      if (this.visibleIndexes.length > 0) {
        this.selectedVisibleIndex = Math.max(0, this.selectedVisibleIndex - 1);
      }
      return;
    }

    if (key.name === 'enter') {
      this.selectDictionaryByVisibleIndex(this.selectedVisibleIndex);
      this.maybeAutoPlay();
    }
  }

  private handleTaskKey(ch: string | undefined, key: blessed.Widgets.Events.IKeyEventArg): void {
    const mode = this.session.getCurrentMode();
    const lowerCh = (ch || '').toLowerCase();
    const lowerName = (key.name || '').toLowerCase();
    const lowerFull = (key.full || '').toLowerCase();
    const matches = (letter: string): boolean =>
      lowerCh === letter || lowerName === letter || lowerFull === letter;

    if (mode === 'rating') {
      if (key.full === 'S-g' && this.session.isLeechTask()) {
        this.session.markGeminiNotice();
        return;
      }
      if (matches('t')) {
        void this.translateCurrentSentenceInRating();
        return;
      }
      if (matches('e')) {
        void this.playCurrentSentenceInRating('elevenlabs');
        return;
      }
      if (matches('f')) {
        void this.playCurrentSentenceInRating();
        return;
      }
      if (matches('a')) this.session.applyRating('again');
      if (matches('s')) this.session.applyRating('hard');
      if (matches('d')) this.session.applyRating('good');
      return;
    }

    if (key.name === 'backspace') {
      this.session.handleBackspace();
      return;
    }

    if (key.name === 'enter') {
      this.session.handleEnter();
      return;
    }

    if (isPrintableChar(ch)) {
      this.session.handlePrintable(ch);
    }
  }

  private async closeYouGlishOverlay(): Promise<void> {
    const closingMode = this.youglishState.mode;
    try {
      const snapshot = await this.youglishBridge.pause();
      this.applyYouGlishSnapshot(snapshot);
    } catch {
      // ignore pause failures; still close overlay
    }
    if (closingMode === 'chunks') {
      await this.persistChunkRadioProgress();
      this.chunkRadioState.jumpInputMode = false;
      this.chunkRadioState.jumpInput = '';
    }
    this.setYouGlishVisibility(false);
    this.runtimeNotice = 'YouGlish paused and overlay closed';
  }

  private getChunkCount(): number {
    return this.chunkRadioState.chunks.length;
  }

  private wrapChunkIndex(index: number): number {
    const total = this.getChunkCount();
    if (total <= 0) {
      return 0;
    }
    const mod = index % total;
    return mod < 0 ? mod + total : mod;
  }

  private currentChunkText(): string {
    if (this.getChunkCount() <= 0) {
      return '';
    }
    return this.chunkRadioState.chunks[this.chunkRadioState.currentIndex] ?? '';
  }

  private resolveChunkTarget(totalClips: number): number {
    if (!Number.isFinite(totalClips) || totalClips <= 0) {
      return 20;
    }
    return Math.max(1, Math.min(20, Math.floor(totalClips)));
  }

  private getChunkConsumedInCurrentQuery(clipIndex: number): number {
    const boundedIndex = Number.isFinite(clipIndex) ? Math.max(0, Math.floor(clipIndex)) : 0;
    return Math.max(0, Math.min(this.chunkRadioState.activeTarget, boundedIndex));
  }

  private sanitizeChunkPhrase(text: string): string {
    return text
      .replace(/\[\[\[/g, '')
      .replace(/\]\]\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async persistChunkRadioProgress(): Promise<void> {
    if (!this.chunkRadioState.touched) {
      return;
    }
    if (this.getChunkCount() <= 0) {
      return;
    }
    try {
      await this.chunkProgressStore.saveCurrent(
        this.chunkRadioState.currentIndex,
        this.chunkRadioState.chunks,
      );
    } catch (error) {
      this.runtimeNotice = `Save chunk progress failed: ${(error as Error).message}`;
    }
  }

  private setYouGlishVisibility(visible: boolean): void {
    this.youglishState.visible = visible;
    if (visible) {
      this.startYouGlishPoller();
    } else {
      this.stopYouGlishPoller();
    }
  }

  private startYouGlishPoller(): void {
    if (this.youglishPoller) return;
    this.youglishPoller = setInterval(() => {
      if (!this.youglishState.visible || this.stopping) return;
      void this.syncYouGlishSnapshot();
    }, 800);
  }

  private stopYouGlishPoller(): void {
    if (!this.youglishPoller) return;
    clearInterval(this.youglishPoller);
    this.youglishPoller = null;
  }

  private applyYouGlishSnapshot(snapshot: YouGlishSnapshot): void {
    const normalizedPhrase =
      this.youglishState.mode === 'chunks'
        ? this.sanitizeChunkPhrase(snapshot.phrase)
        : snapshot.phrase;

    this.youglishState.query = snapshot.query || this.youglishState.query;
    this.youglishState.clipIndex = snapshot.clipIndex;
    this.youglishState.totalClips = snapshot.totalClips;
    this.youglishState.consumedCount = snapshot.consumedCount;
    this.youglishState.speed = snapshot.speed;
    this.youglishState.autoNextGapMs = snapshot.autoNextGapMs;
    this.youglishState.videoId = snapshot.videoId;
    this.youglishState.phrase = normalizedPhrase;
    this.youglishState.playerState = snapshot.playerState;
    this.youglishState.message = snapshot.message;
    this.youglishState.error = snapshot.errorCode ? `code ${snapshot.errorCode}` : '';
    if (snapshot.message.startsWith('bridge-error')) {
      this.runtimeNotice = snapshot.message;
    }

    if (snapshot.captionId && snapshot.captionId !== this.lastYouglishCaptionId) {
      this.lastYouglishCaptionId = snapshot.captionId;
      this.youglishState.phraseTranslation = '';
      void this.translateCurrentYouGlishPhrase();
    }
  }

  private async syncYouGlishSnapshot(): Promise<void> {
    const snapshot = await this.youglishBridge.getSnapshot();
    this.applyYouGlishSnapshot(snapshot);
    if (this.youglishState.visible && this.youglishState.mode === 'chunks') {
      await this.handleChunkRadioAutoAdvance(snapshot);
    }
    if (this.youglishState.visible) {
      await this.maybeRecoverYouGlishReadyTimeout(snapshot);
    }
    this.render();
  }

  private async maybeRecoverYouGlishReadyTimeout(snapshot: YouGlishSnapshot): Promise<void> {
    if (this.youglishRecovering) {
      return;
    }
    if (snapshot.message !== 'ready-timeout-giveup') {
      return;
    }
    const now = Date.now();
    if (now - this.lastYouglishRecoverAt < 30000) {
      return;
    }

    this.youglishRecovering = true;
    this.lastYouglishRecoverAt = now;
    this.runtimeNotice = 'YouGlish ready timeout; restarting bridge once...';
    this.render();

    try {
      await this.youglishBridge.close();
      if (this.youglishState.mode === 'chunks') {
        await this.fetchChunkAtCurrentIndex('reload');
      } else {
        const word = this.session.getCurrentWordName().trim();
        if (word) {
          const next = await this.youglishBridge.fetch(word, 'english', 'us');
          this.applyYouGlishSnapshot(next);
        }
      }
    } catch (error) {
      this.runtimeNotice = `YouGlish recovery failed: ${(error as Error).message}`;
    } finally {
      this.youglishRecovering = false;
    }
  }

  private async openYouGlishForCurrentWord(): Promise<void> {
    const word = this.session.getCurrentWordName().trim();
    if (!word) {
      this.runtimeNotice = 'No current word for YouGlish';
      this.render();
      return;
    }

    this.runtimeNotice = `Opening YouGlish for ${word}...`;
    this.youglishState = {
      visible: true,
      mode: 'word',
      query: word,
      clipIndex: 0,
      totalClips: 0,
      consumedCount: 0,
      speed: 1,
      autoNextGapMs: 900,
      phrase: '',
      phraseTranslation: '',
      playerState: 'unknown',
      videoId: '',
      message: 'launching',
      error: '',
    };
    this.lastYouglishCaptionId = 0;
    this.render();

    try {
      const snapshot = await this.youglishBridge.fetch(word, 'english', 'us');
      this.applyYouGlishSnapshot(snapshot);
      this.setYouGlishVisibility(true);
      this.runtimeNotice = snapshot.message.startsWith('bridge-error')
        ? snapshot.message
        : `YouGlish active: ${word}`;
    } catch (error) {
      this.setYouGlishVisibility(true);
      this.youglishState.message = 'open-failed';
      this.youglishState.error = (error as Error).message;
      this.runtimeNotice = `YouGlish open failed: ${(error as Error).message}`;
    }
    this.render();
  }

  private async openYouGlishChunkRadio(startIndex?: number): Promise<void> {
    if (this.getChunkCount() <= 0) {
      this.runtimeNotice = 'No chunks available';
      this.render();
      return;
    }

    const baseIndex =
      typeof startIndex === 'number'
        ? this.wrapChunkIndex(startIndex)
        : this.wrapChunkIndex(this.chunkRadioState.currentIndex);
    this.chunkRadioState.touched = true;
    this.chunkRadioState.currentIndex = baseIndex;
    this.chunkRadioState.activeStartConsumed = 0;
    this.chunkRadioState.activeTarget = 20;
    this.chunkRadioState.switching = false;
    this.chunkRadioState.jumpInputMode = false;
    this.chunkRadioState.jumpInput = '';

    const query = this.currentChunkText();
    this.runtimeNotice = `Opening Chunk Radio: ${baseIndex + 1}/${this.getChunkCount()}`;
    this.youglishState = {
      visible: true,
      mode: 'chunks',
      query,
      clipIndex: 0,
      totalClips: 0,
      consumedCount: 0,
      speed: 1,
      autoNextGapMs: 900,
      phrase: '',
      phraseTranslation: '',
      playerState: 'unknown',
      videoId: '',
      message: 'launching',
      error: '',
    };
    this.lastYouglishCaptionId = 0;
    this.render();

    await this.fetchChunkAtCurrentIndex('open');
    this.setYouGlishVisibility(true);
    this.render();
  }

  private async fetchChunkAtCurrentIndex(reason: 'open' | 'manual' | 'auto' | 'reload' | 'jump'): Promise<void> {
    const chunk = this.currentChunkText();
    if (!chunk) {
      this.runtimeNotice = 'Current chunk is empty';
      return;
    }

    this.chunkRadioState.switching = true;
    this.youglishState.query = chunk;
    this.youglishState.message = 'chunk-fetching';
    this.youglishState.error = '';
    this.youglishState.phrase = '';
    this.youglishState.phraseTranslation = '';
    this.lastYouglishCaptionId = 0;
    this.render();

    try {
      const snapshot = await this.youglishBridge.fetch(chunk, 'english', 'us');
      this.applyYouGlishSnapshot(snapshot);
      this.chunkRadioState.activeStartConsumed = snapshot.consumedCount;
      this.chunkRadioState.activeTarget =
        snapshot.totalClips > 0 ? this.resolveChunkTarget(snapshot.totalClips) : 20;

      if (reason === 'auto') {
        this.runtimeNotice = `Chunk auto-next: ${this.chunkRadioState.currentIndex + 1}/${this.getChunkCount()}`;
      } else if (reason === 'reload') {
        this.runtimeNotice = `Chunk reloaded: ${this.chunkRadioState.currentIndex + 1}/${this.getChunkCount()}`;
      } else if (reason === 'jump') {
        this.runtimeNotice = `Jumped to chunk ${this.chunkRadioState.currentIndex + 1}/${this.getChunkCount()}`;
      } else if (reason === 'manual') {
        this.runtimeNotice = `Chunk switched: ${this.chunkRadioState.currentIndex + 1}/${this.getChunkCount()}`;
      } else {
        this.runtimeNotice = `Chunk active: ${this.chunkRadioState.currentIndex + 1}/${this.getChunkCount()}`;
      }
    } catch (error) {
      this.runtimeNotice = `Chunk fetch failed: ${(error as Error).message}`;
    } finally {
      this.chunkRadioState.switching = false;
    }
  }

  private async stepChunk(delta: number, reason: 'manual' | 'auto'): Promise<void> {
    if (this.getChunkCount() <= 0) {
      this.runtimeNotice = 'No chunks available';
      return;
    }
    this.chunkRadioState.currentIndex = this.wrapChunkIndex(this.chunkRadioState.currentIndex + delta);
    await this.fetchChunkAtCurrentIndex(reason);
  }

  private async jumpToChunkByInput(raw: string): Promise<void> {
    const trimmed = raw.trim();
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 1) {
      this.runtimeNotice = `Invalid chunk index: ${trimmed || '(empty)'}`;
      return;
    }
    const index = this.wrapChunkIndex(Math.floor(parsed) - 1);
    this.chunkRadioState.currentIndex = index;
    await this.fetchChunkAtCurrentIndex('jump');
  }

  private async handleChunkRadioAutoAdvance(snapshot: YouGlishSnapshot): Promise<void> {
    if (this.youglishState.mode !== 'chunks') {
      return;
    }
    if (this.chunkRadioState.switching) {
      return;
    }
    if (this.getChunkCount() <= 0) {
      return;
    }

    if (snapshot.totalClips > 0) {
      const resolvedTarget = this.resolveChunkTarget(snapshot.totalClips);
      if (resolvedTarget !== this.chunkRadioState.activeTarget) {
        this.chunkRadioState.activeTarget = resolvedTarget;
      }
    }
    const consumed = this.getChunkConsumedInCurrentQuery(snapshot.clipIndex);
    const target = this.chunkRadioState.activeTarget || 20;

    const noResultAdvance =
      snapshot.totalClips <= 0 && (snapshot.message === 'fetch-zero' || snapshot.message === 'fetch-done');
    const clipAdvance = snapshot.totalClips > 0 && consumed >= target;
    if (!noResultAdvance && !clipAdvance) {
      return;
    }
    await this.stepChunk(1, 'auto');
  }

  private async handleYouGlishOverlayKey(
    ch: string | undefined,
    key: blessed.Widgets.Events.IKeyEventArg,
  ): Promise<boolean> {
    const lowerCh = (ch || '').toLowerCase();
    const full = (key.full || '').toLowerCase();
    const name = (key.name || '').toLowerCase();
    const isChunkMode = this.youglishState.mode === 'chunks';

    if (isChunkMode && this.chunkRadioState.jumpInputMode) {
      if (key.name === 'enter') {
        const input = this.chunkRadioState.jumpInput;
        this.chunkRadioState.jumpInputMode = false;
        this.chunkRadioState.jumpInput = '';
        await this.jumpToChunkByInput(input);
        return true;
      }
      if (key.name === 'backspace') {
        this.chunkRadioState.jumpInput = this.chunkRadioState.jumpInput.slice(0, -1);
        return true;
      }
      if (isPrintableChar(ch) && /[0-9]/.test(ch)) {
        this.chunkRadioState.jumpInput += ch;
        return true;
      }
      return true;
    }

    if (key.name === 'space') {
      const snapshot = await this.youglishBridge.playPause();
      this.applyYouGlishSnapshot(snapshot);
      this.runtimeNotice = `YouGlish ${snapshot.playerState}`;
      return true;
    }

    if (isChunkMode && (lowerCh === 'n' || name === 'n' || full === 'n')) {
      await this.stepChunk(1, 'manual');
      return true;
    }

    if (isChunkMode && (lowerCh === 'b' || name === 'b' || full === 'b')) {
      await this.stepChunk(-1, 'manual');
      return true;
    }

    if (isChunkMode && (lowerCh === 'j' || name === 'j' || full === 'j')) {
      this.chunkRadioState.jumpInputMode = true;
      this.chunkRadioState.jumpInput = '';
      this.runtimeNotice = `Jump chunk: input 1-${this.getChunkCount()} then Enter`;
      return true;
    }

    if (lowerCh === 'x' || name === 'x' || full === 'x') {
      this.runtimeNotice = 'Manual bridge restart...';
      this.render();
      try {
        await this.youglishBridge.close();
        if (isChunkMode) {
          await this.fetchChunkAtCurrentIndex('reload');
        } else {
          const word = this.session.getCurrentWordName().trim();
          if (word) {
            const snapshot = await this.youglishBridge.fetch(word, 'english', 'us');
            this.applyYouGlishSnapshot(snapshot);
          }
        }
      } catch (error) {
        this.runtimeNotice = `Manual restart failed: ${(error as Error).message}`;
      }
      return true;
    }

    if (ch === '-' || full === '-') {
      const snapshot = await this.youglishBridge.adjustSpeed(-0.08);
      this.applyYouGlishSnapshot(snapshot);
      this.runtimeNotice = `YouGlish speed: ${snapshot.speed.toFixed(2)}x`;
      return true;
    }

    if (ch === '=' || full === '=' || ch === '+') {
      const snapshot = await this.youglishBridge.adjustSpeed(0.08);
      this.applyYouGlishSnapshot(snapshot);
      this.runtimeNotice = `YouGlish speed: ${snapshot.speed.toFixed(2)}x`;
      return true;
    }

    if (ch === ',' || full === ',') {
      const snapshot = await this.youglishBridge.adjustAutoNextGap(180);
      this.applyYouGlishSnapshot(snapshot);
      this.runtimeNotice = `YouGlish switch delay: ${snapshot.autoNextGapMs}ms`;
      return true;
    }

    if (ch === '.' || full === '.') {
      const snapshot = await this.youglishBridge.adjustAutoNextGap(-180);
      this.applyYouGlishSnapshot(snapshot);
      this.runtimeNotice = `YouGlish switch delay: ${snapshot.autoNextGapMs}ms`;
      return true;
    }

    if (ch === '[' || full === '[') {
      const snapshot = await this.youglishBridge.previous();
      this.applyYouGlishSnapshot(snapshot);
      this.runtimeNotice = 'YouGlish previous clip';
      return true;
    }

    if (ch === ']' || full === ']') {
      const snapshot = await this.youglishBridge.next();
      this.applyYouGlishSnapshot(snapshot);
      this.runtimeNotice = 'YouGlish next clip';
      return true;
    }

    if (lowerCh === 't' || name === 't' || full === 't') {
      await this.translateCurrentYouGlishPhrase();
      return true;
    }

    if (lowerCh === 'r' || name === 'r' || full === 'r') {
      if (isChunkMode) {
        await this.fetchChunkAtCurrentIndex('reload');
        return true;
      }

      const word = this.session.getCurrentWordName().trim();
      if (!word) {
        this.runtimeNotice = 'No current word for YouGlish reload';
        return true;
      }
      const snapshot = await this.youglishBridge.fetch(word, 'english', 'us');
      this.applyYouGlishSnapshot(snapshot);
      this.runtimeNotice = `YouGlish reloaded: ${word}`;
      return true;
    }

    return false;
  }

  private async translateCurrentYouGlishPhrase(): Promise<void> {
    const phrase = this.youglishState.phrase.trim();
    if (!phrase) {
      this.runtimeNotice = 'No phrase to translate';
      this.youglishState.phraseTranslation = '';
      return;
    }

    const cached = this.youglishTranslationCache.get(phrase);
    if (cached) {
      this.youglishState.phraseTranslation = cached;
      this.runtimeNotice = 'Phrase translation loaded from cache';
      return;
    }

    const token = Date.now();
    this.youglishTranslateToken = token;
    this.runtimeNotice = 'Translating YouGlish phrase...';
    this.youglishState.phraseTranslation = '(translating...)';
    this.render();

    try {
      const result = await translateSentenceToChinese(phrase);
      if (this.youglishTranslateToken !== token) {
        return;
      }
      if (!result.translation) {
        this.youglishState.phraseTranslation = '(translation unavailable)';
        this.runtimeNotice = 'Phrase translation unavailable';
        return;
      }
      this.youglishTranslationCache.set(phrase, result.translation);
      this.youglishState.phraseTranslation = result.translation;
      this.runtimeNotice = `Phrase translated (${result.source})`;
    } catch (error) {
      if (this.youglishTranslateToken !== token) {
        return;
      }
      this.youglishState.phraseTranslation = '(translate failed)';
      this.runtimeNotice = `Phrase translate failed: ${(error as Error).message}`;
    }
  }

  private async replayCurrentWord(): Promise<void> {
    const word = this.session.getCurrentWordName();
    await this.playWordAndTrackNotice(word);
  }

  private async playCurrentSentenceInRating(provider: 'default' | 'elevenlabs' = 'default'): Promise<void> {
    const sentence = this.session.getCurrentSentence();
    if (!sentence) {
      this.runtimeNotice = 'No sentence to play';
      this.render();
      return;
    }

    this.runtimeNotice =
      provider === 'elevenlabs' ? 'Playing sentence via ElevenLabs...' : 'Playing sentence...';
    this.render();

    const result =
      provider === 'elevenlabs'
        ? await this.voicePlayer.playSentenceElevenLabs(sentence)
        : await this.voicePlayer.playSentence(sentence);
    const notice = this.voicePlayer.getLastNotice();
    if (notice) {
      this.runtimeNotice = notice;
    } else if (!result.ok && result.reason) {
      this.runtimeNotice = result.reason;
    } else if (result.ok) {
      this.runtimeNotice =
        provider === 'elevenlabs' ? 'Sentence played (ElevenLabs)' : 'Sentence played';
    }
    this.render();
  }

  private async translateCurrentSentenceInRating(): Promise<void> {
    const sentence = this.session.getCurrentSentence();
    if (!sentence) {
      this.runtimeNotice = 'No sentence to translate';
      this.session.setTaskNotice(this.runtimeNotice);
      this.render();
      return;
    }

    this.runtimeNotice = 'Translating sentence...';
    this.session.setTaskNotice(this.runtimeNotice);
    this.render();

    try {
      const result = await translateSentenceToChinese(sentence);
      if (!result.translation) {
        this.runtimeNotice = 'Sentence translation unavailable';
        this.session.setTaskNotice(this.runtimeNotice);
      } else {
        const source = result.source === 'google' ? 'google' : 'mymemory';
        this.runtimeNotice = `Sentence CN (${source}): ${result.translation}`;
        this.session.setTaskNotice(`Sentence CN: ${result.translation}`);
      }
    } catch (error) {
      this.runtimeNotice = `Translate failed: ${(error as Error).message}`;
      this.session.setTaskNotice(this.runtimeNotice);
    }
    this.render();
  }

  private maybeAutoPlay(): void {
    if (this.youglishState.visible) {
      return;
    }
    const autoPlayInfo = this.session.getAutoPlayInfo();
    if (!autoPlayInfo) {
      return;
    }

    if (autoPlayInfo.key === this.lastAutoPlaySuccessKey) {
      return;
    }

    const now = Date.now();
    const canAttempt =
      autoPlayInfo.key !== this.lastAutoPlayAttemptKey || now - this.lastAutoPlayAttemptAt >= 2000;
    if (!canAttempt) {
      return;
    }

    this.lastAutoPlayAttemptKey = autoPlayInfo.key;
    this.lastAutoPlayAttemptAt = now;
    void this.playWordAndTrackNotice(autoPlayInfo.word, autoPlayInfo.key);
  }

  private async addSentenceToCurrentWord(): Promise<void> {
    const dict = this.getCurrentDictionary();
    const word = this.session.getCurrentWordName().trim();
    if (!dict || !word) {
      this.runtimeNotice = 'No current word';
      this.render();
      return;
    }

    this.runtimeNotice = `Querying sentence for ${word}...`;
    this.render();

    try {
      const queried = await querySentenceForWord(word);
      if (!queried.sentence) {
        this.runtimeNotice = `No sentence found for ${word}`;
        this.render();
        return;
      }

      const changed = await upsertWordSentenceInDict(dict.filePath, word, queried.sentence);
      if (!changed) {
        this.runtimeNotice = `Sentence already exists for ${word}`;
        this.render();
        return;
      }

      await this.reloadCurrentDictionary();
      const sourceInfo = queried.source === 'dictionaryapi' ? 'dictionaryapi' : 'fallback';
      this.runtimeNotice = `Sentence saved for ${word} (${sourceInfo})`;
      this.render();
    } catch (error) {
      this.runtimeNotice = `Add sentence failed: ${(error as Error).message}`;
      this.render();
    }
  }

  private async playWordAndTrackNotice(word: string, autoPlayKey?: string): Promise<void> {
    const result = await this.voicePlayer.playWord(word);
    const notice = this.voicePlayer.getLastNotice();
    if (notice) {
      this.runtimeNotice = notice;
    } else if (result.ok) {
      this.runtimeNotice = '';
    }

    if (result.ok && autoPlayKey) {
      this.lastAutoPlaySuccessKey = autoPlayKey;
    }
    this.render();
  }

  private async reloadCurrentDictionary(): Promise<void> {
    const currentId = this.getCurrentDictionary()?.id ?? '';
    this.dictionaries = await loadDictionaries(this.dictDir);
    this.applySearchFilter();

    if (this.visibleIndexes.length === 0) {
      this.selectDictionaryByVisibleIndex(0);
      this.render();
      return;
    }

    const exactVisibleIndex = this.visibleIndexes.findIndex(
      (index) => this.dictionaries[index]?.id === currentId,
    );

    this.selectDictionaryByVisibleIndex(exactVisibleIndex >= 0 ? exactVisibleIndex : 0);
    this.render();
    this.maybeAutoPlay();
  }

  private render(): void {
    const currentDict = this.getCurrentDictionary();
    const taskView = this.session.getViewModel();

    renderDataset(this.layout, {
      dictionaries: this.dictionaries,
      visibleIndexes: this.visibleIndexes,
      selectedVisibleIndex: this.selectedVisibleIndex,
      focused: this.focus === 'dataset' && !this.searchMode,
      searchTerm: this.searchTerm,
    });

    renderTask(this.layout, taskView, this.focus === 'task');

    renderYouGlish(this.layout, {
      visible: this.youglishState.visible,
      mode: this.youglishState.mode,
      query: this.youglishState.query,
      clipIndex: this.youglishState.clipIndex,
      totalClips: this.youglishState.totalClips,
      consumedCount: this.youglishState.consumedCount,
      phrase: this.youglishState.phrase,
      phraseTranslation: this.youglishState.phraseTranslation,
      playerState: this.youglishState.playerState,
      videoId: this.youglishState.videoId,
      speed: this.youglishState.speed,
      autoNextGapMs: this.youglishState.autoNextGapMs,
      message: this.youglishState.message,
      error: this.youglishState.error,
      chunkIndex: this.chunkRadioState.currentIndex,
      chunkTotal: this.getChunkCount(),
      chunkConsumed: this.getChunkConsumedInCurrentQuery(this.youglishState.clipIndex),
      chunkTarget: this.chunkRadioState.activeTarget,
      jumpInput: this.chunkRadioState.jumpInputMode ? this.chunkRadioState.jumpInput : '',
    });

    const mode = this.youglishState.visible
      ? this.youglishState.mode === 'chunks'
        ? 'youglish_chunks'
        : 'youglish'
      : this.searchMode
        ? 'search'
      : this.focus === 'task'
        ? taskView.mode
        : ('normal' as const);

    renderStatus(this.layout, {
      focus: this.focus,
      mode,
      currentDictId: currentDict?.id ?? '-',
      currentWordProgress: `${taskView.wordIndex}/${taskView.wordTotal}`,
      audioMuted: this.voicePlayer.isMuted(),
      accent: this.voicePlayer.getAccent(),
      leech: this.session.isLeechTask(),
      notice: this.runtimeNotice,
    });

    this.screen.render();
  }

  async shutdown(): Promise<void> {
    if (this.stopping) {
      return;
    }
    this.stopping = true;
    if (this.autoPlayTicker) {
      clearInterval(this.autoPlayTicker);
      this.autoPlayTicker = null;
    }
    this.stopYouGlishPoller();
    await this.persistChunkRadioProgress();
    try {
      await this.youglishBridge.close();
    } catch {
      // ignore bridge shutdown errors
    }
    try {
      await this.progressStore.save();
    } catch {
      // ignore save failures during shutdown
    }
    this.screen.destroy();
    process.exit(0);
  }
}
