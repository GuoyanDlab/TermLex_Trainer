export interface TypingResult {
  hasError: boolean;
  errorCount: number;
  isComplete: boolean;
}

function escapeTagText(input: string): string {
  return input.replace(/\{/g, '\\{').replace(/\}/g, '\\}');
}

export function evaluateTyping(target: string, input: string): TypingResult {
  let errorCount = 0;
  const overlap = Math.min(target.length, input.length);
  for (let i = 0; i < overlap; i += 1) {
    if (target[i] !== input[i]) {
      errorCount += 1;
    }
  }
  if (input.length > target.length) {
    errorCount += input.length - target.length;
  }
  return {
    hasError: errorCount > 0,
    errorCount,
    isComplete: input.length >= target.length,
  };
}

export function renderTypingComparison(target: string, input: string): string {
  const safeTarget = escapeTagText(target);
  const safeInput = escapeTagText(input);
  if (!safeInput) {
    return `{gray-fg}${safeTarget}{/gray-fg}`;
  }

  const chars: string[] = [];
  for (let i = 0; i < safeInput.length; i += 1) {
    const current = safeInput[i];
    const targetChar = safeTarget[i];
    if (targetChar === undefined || current !== targetChar) {
      chars.push(`{red-fg}${current}{/red-fg}`);
    } else {
      chars.push(current);
    }
  }

  if (safeTarget.length > safeInput.length) {
    chars.push(`{gray-fg}${safeTarget.slice(safeInput.length)}{/gray-fg}`);
  }

  return chars.join('');
}
