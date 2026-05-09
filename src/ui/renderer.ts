import { DictionaryRecord, SessionMode, TaskViewModel } from '../types';
import { AppLayout } from './layout';
import { theme } from './theme';

function safeText(value: string): string {
  return value.replace(/\{/g, '(').replace(/\}/g, ')');
}

export interface DatasetRenderState {
  dictionaries: DictionaryRecord[];
  visibleIndexes: number[];
  selectedVisibleIndex: number;
  focused: boolean;
  searchTerm: string;
}

export interface StatusRenderState {
  focus: 'dataset' | 'task';
  mode: SessionMode | 'search' | 'normal' | 'youglish' | 'youglish_chunks';
  currentDictId: string;
  currentWordProgress: string;
  audioMuted: boolean;
  accent: 'us' | 'uk';
  leech: boolean;
  notice?: string;
}

export interface YouGlishRenderState {
  visible: boolean;
  mode: 'word' | 'chunks';
  query: string;
  clipIndex: number;
  totalClips: number;
  consumedCount: number;
  speed?: number;
  autoNextGapMs?: number;
  phrase: string;
  phraseTranslation: string;
  playerState: string;
  videoId: string;
  message: string;
  error?: string;
  chunkIndex?: number;
  chunkTotal?: number;
  chunkConsumed?: number;
  chunkTarget?: number;
  jumpInput?: string;
}

function withNotice(base: string, notice?: string): string {
  if (!notice) return base;
  return `${base} | ${notice}`;
}

export function renderDataset(layout: AppLayout, state: DatasetRenderState): void {
  const { dictionaries, visibleIndexes, selectedVisibleIndex, focused, searchTerm } = state;
  const items = visibleIndexes.map((index) => {
    const dict = dictionaries[index];
    return `${dict.id.padEnd(20, ' ')} ${dict.words.length} words`;
  });

  layout.datasetList.setItems(items.length > 0 ? items : ['No dictionaries']);
  const boundedIndex =
    items.length === 0
      ? 0
      : Math.max(0, Math.min(selectedVisibleIndex, items.length - 1));
  layout.datasetList.select(boundedIndex);

  layout.datasetPanel.style.border = focused ? theme.focusedBorder : theme.border;
  layout.datasetPanel.setLabel(
    searchTerm ? ` Dataset Panel (/ ${safeText(searchTerm)}) ` : ' Dataset Panel ',
  );
}

export function renderTask(layout: AppLayout, view: TaskViewModel, focused: boolean): void {
  layout.taskPanel.style.border = focused ? theme.focusedBorder : theme.border;

  const lines: string[] = [];
  lines.push(`Task Type      : ${view.taskType}`);
  lines.push(`Stage          : ${view.stage}`);
  lines.push(`Word Progress  : ${view.wordIndex}/${view.wordTotal}`);
  lines.push('');
  lines.push(`Prompt         : ${safeText(view.prompt)}`);
  lines.push(`Current Word   : ${safeText(view.wordDisplay)}`);
  lines.push('');
  lines.push(`Input / Progress`);
  lines.push(`${view.typingDisplay}`);
  lines.push('');
  lines.push(`Repeat         : ${view.repeatDone}/${view.repeatTarget}`);
  lines.push(`Errors         : ${view.wrongRounds}`);
  lines.push('');
  lines.push(`Chinese        : ${safeText(view.translationDisplay)}`);
  lines.push(`English Mean   : ${safeText(view.englishMeaningDisplay)}`);
  lines.push(`Sentence       : ${safeText(view.sentenceDisplay)}`);
  lines.push(`Speech         : ${safeText(view.speechDisplay)}`);
  lines.push(`Phone          : ${safeText(view.phoneDisplay)}`);
  if (view.meaningAnswerDisplay) {
    lines.push(`Meaning Check  : ${safeText(view.meaningAnswerDisplay)}`);
  }
  if (view.mode === 'rating') {
    lines.push(`Rating         : ${view.ratingHint}`);
  }
  if (view.notice) {
    lines.push('');
    lines.push(`Notice         : ${safeText(view.notice)}`);
  }

  layout.taskPanel.setContent(lines.join('\n'));
  layout.taskPanel.setScroll(0);
}

export function renderStatus(layout: AppLayout, status: StatusRenderState): void {
  const audio = status.audioMuted ? 'mute:on' : 'mute:off';
  const accent = `accent:${status.accent}`;

  if (status.mode === 'youglish') {
    layout.statusBar.setContent(withNotice(
      `YOUGLISH | ${status.currentDictId} | Ctrl+Y/Esc close | Space pause/play | [ prev | ] next | - slower | = faster | , delay+ | . delay- | t translate phrase | r reload word | x restart bridge | q quit`,
      status.notice,
    ));
    return;
  }

  if (status.mode === 'youglish_chunks') {
    layout.statusBar.setContent(withNotice(
      `CHUNKS | ${status.currentDictId} | Ctrl+O/Esc close | Space pause/play | n next chunk | b prev chunk | j jump | [ prev | ] next | - slower | = faster | , delay+ | . delay- | t translate phrase | r reload chunk | x restart bridge | q quit`,
      status.notice,
    ));
    return;
  }

  if (status.mode === 'search') {
    layout.statusBar.setContent(withNotice(
      `SEARCH | ${status.currentDictId} | type to filter | Enter apply | Esc clear | Tab switch | q quit | ${audio} | ${accent}`,
      status.notice,
    ));
    return;
  }

  if (status.mode === 'typing') {
    layout.statusBar.setContent(withNotice(
      `TYPING | ${status.currentDictId} | ${status.currentWordProgress} | Enter submit | Ctrl+Y Word YouGlish | Ctrl+O Chunk Radio | Ctrl+E add sentence | Shift+P replay | Shift+M mute | Shift+U accent | Shift+R reload | Shift+Q/Ctrl+C quit`,
      status.notice,
    ));
    return;
  }

  if (status.mode === 'meaning') {
    layout.statusBar.setContent(withNotice(
      `MEANING | ${status.currentDictId} | ${status.currentWordProgress} | Enter submit | Ctrl+Y Word YouGlish | Ctrl+O Chunk Radio | Ctrl+E add sentence | Shift+P replay | Shift+M mute | Shift+U accent | Shift+R reload | Shift+Q/Ctrl+C quit`,
      status.notice,
    ));
    return;
  }

  if (status.mode === 'rating') {
    const leechHint = status.leech ? ' | Shift+G gemini' : '';
    layout.statusBar.setContent(withNotice(
      `RATE | ${status.currentDictId} | ${status.currentWordProgress} | a again | s hard | d good | e ElevenLabs cycle | f sentence | t translate | Ctrl+Y Word YouGlish | Ctrl+O Chunk Radio${leechHint} | Shift+M mute | Shift+U accent | Tab switch | q quit | ${audio} | ${accent}`,
      status.notice,
    ));
    return;
  }

  layout.statusBar.setContent(withNotice(
    `NORMAL | ${status.currentDictId} | ${status.currentWordProgress} | / search | Enter load | Ctrl+Y Word YouGlish | Ctrl+O Chunk Radio | Ctrl+E add sentence | Tab switch | q quit | ${audio} | ${accent}`,
    status.notice,
  ));
}

export function renderYouGlish(layout: AppLayout, state: YouGlishRenderState): void {
  if (!state.visible) {
    layout.youglishPanel.hide();
    return;
  }

  const safePhrase = safeText(state.phrase || '(waiting for phrase...)');
  const safeTranslation = safeText(state.phraseTranslation || '(translation pending)');
  const safeMessage = safeText(state.message || '-');
  const safeError = safeText(state.error || '-');

  const lines: string[] = [];
  lines.push(state.mode === 'chunks' ? 'YouGlish Chunk Radio Mode' : 'YouGlish Audio Mode');
  lines.push('');
  if (state.mode === 'chunks') {
    const chunkIndex = state.chunkIndex ?? 0;
    const chunkTotal = state.chunkTotal ?? 0;
    const chunkConsumed = state.chunkConsumed ?? 0;
    const chunkTarget = state.chunkTarget ?? 20;
    lines.push(`Chunk          : ${chunkIndex + 1}/${chunkTotal || 0}`);
    lines.push(`Consumed       : ${chunkConsumed}/${chunkTarget}`);
    if (state.jumpInput) {
      lines.push(`Jump Input     : ${safeText(state.jumpInput)}`);
    }
    lines.push('');
  }
  lines.push(`Query          : ${safeText(state.query || '-')}`);
  lines.push(`Clip           : ${state.clipIndex}/${state.totalClips || 0}`);
  if (state.mode === 'chunks') {
    lines.push(`Caption Count  : ${state.consumedCount}`);
  } else {
    lines.push(`Consumed Total : ${state.consumedCount}`);
  }
  lines.push(`Player         : ${safeText(state.playerState)}`);
  lines.push(`Video          : ${safeText(state.videoId || '-')}`);
  lines.push(`Speed          : ${Number.isFinite(state.speed) ? Number(state.speed).toFixed(2) : '1.00'}x`);
  lines.push(`Switch Delay   : ${Number.isFinite(state.autoNextGapMs) ? Math.round(Number(state.autoNextGapMs)) : 900}ms`);
  lines.push('');
  lines.push('Phrase');
  lines.push(`${safePhrase}`);
  lines.push('');
  lines.push('Phrase CN');
  lines.push(`${safeTranslation}`);
  lines.push('');
  lines.push(`Bridge Message : ${safeMessage}`);
  lines.push(`Bridge Error   : ${safeError}`);
  lines.push('');
  if (state.mode === 'chunks') {
    lines.push('Keys: Ctrl+O/Esc close | Space pause/play | n next chunk | b prev chunk | j jump | [ prev | ] next | - slower | = faster | , delay+ | . delay- | t translate phrase | r reload chunk | x restart bridge');
  } else {
    lines.push('Keys: Ctrl+Y/Esc close | Space pause/play | [ prev | ] next | - slower | = faster | , delay+ | . delay- | t translate phrase | r reload word | x restart bridge');
  }

  layout.youglishPanel.setContent(lines.join('\n'));
  layout.youglishPanel.setScroll(0);
  layout.youglishPanel.show();
  layout.youglishPanel.setFront();
}
