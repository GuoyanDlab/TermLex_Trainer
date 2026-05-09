import { SessionTask, Stage, TaskType, WordItem, WordProgress } from '../types';

export function getRepeatTarget(stage: Stage): number {
  if (stage === 'new') return 3;
  if (stage === 'encoding') return 3;
  if (stage === 'learning') return 5;
  if (stage === 'reviewing') return 2;
  if (stage === 'mature') return 1;
  if (stage === 'leech') return 5;
  return 1;
}

export function getTaskTypeByStage(stage: Stage): TaskType {
  if (stage === 'new') return 'copy_typing';
  if (stage === 'mature') return 'word_to_meaning';
  return 'meaning_to_word';
}

function getFollowupByStage(stage: Stage, type: TaskType): SessionTask['followup'] {
  if (type === 'word_to_meaning') {
    return 'rating';
  }
  if (stage === 'learning') {
    return 'word_to_meaning';
  }
  return 'rating';
}

export function createTask(progress: WordProgress, _word: WordItem): SessionTask {
  const type = getTaskTypeByStage(progress.stage);
  return {
    type,
    stage: progress.stage,
    repeatTarget: getRepeatTarget(progress.stage),
    repeatDone: 0,
    wrongRounds: 0,
    input: '',
    mode: type === 'word_to_meaning' ? 'meaning' : 'typing',
    followup: getFollowupByStage(progress.stage, type),
    meaningAnswer: '',
    meaningSubmitted: false,
    lastTypingHadError: false,
    notice: '',
  };
}
