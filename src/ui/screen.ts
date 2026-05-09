import blessed from 'neo-blessed';

export function createScreen(): blessed.Widgets.Screen {
  return blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    title: 'TUI Qwerty Learner',
    dockBorders: true,
  });
}
