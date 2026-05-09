import blessed from 'neo-blessed';

export function isQuitKey(ch: string | undefined, key: blessed.Widgets.Events.IKeyEventArg): boolean {
  return ch === 'q' || key.full === 'C-c';
}

export function isDownKey(ch: string | undefined, key: blessed.Widgets.Events.IKeyEventArg): boolean {
  return ch === 'j' || key.name === 'down';
}

export function isUpKey(ch: string | undefined, key: blessed.Widgets.Events.IKeyEventArg): boolean {
  return ch === 'k' || key.name === 'up';
}

export function isPrintableChar(ch: string | undefined): ch is string {
  return typeof ch === 'string' && ch.length === 1 && ch >= ' ' && ch !== '\u007f';
}
