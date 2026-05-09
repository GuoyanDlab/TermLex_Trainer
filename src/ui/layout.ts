import blessed from 'neo-blessed';
import { theme } from './theme';

export interface AppLayout {
  screen: blessed.Widgets.Screen;
  datasetPanel: blessed.Widgets.BoxElement;
  datasetList: blessed.Widgets.ListElement;
  taskPanel: blessed.Widgets.BoxElement;
  youglishPanel: blessed.Widgets.BoxElement;
  statusBar: blessed.Widgets.BoxElement;
}

export function createLayout(screen: blessed.Widgets.Screen): AppLayout {
  const datasetPanel = blessed.box({
    parent: screen,
    label: ' Dataset Panel ',
    top: 0,
    left: 0,
    width: '35%',
    height: '100%-1',
    border: 'line',
    tags: true,
    style: {
      border: theme.border,
    },
  });

  const datasetList = blessed.list({
    parent: datasetPanel,
    top: 1,
    left: 1,
    width: '100%-2',
    height: '100%-2',
    tags: true,
    keys: false,
    mouse: true,
    vi: false,
    style: {
      selected: {
        fg: 'black',
        bg: 'yellow',
      },
      item: {
        fg: 'white',
      },
    },
    scrollbar: {
      ch: ' ',
      style: {
        bg: 'white',
      },
    },
  });

  const taskPanel = blessed.box({
    parent: screen,
    label: ' Task Panel ',
    top: 0,
    left: '35%',
    width: '65%',
    height: '100%-1',
    border: 'line',
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    style: {
      border: theme.border,
    },
  });

  const statusBar = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 1,
    tags: false,
    style: theme.status,
    content: 'Loading...',
  });

  const youglishPanel = blessed.box({
    parent: screen,
    label: ' YouGlish Audio ',
    top: 'center',
    left: 'center',
    width: '92%',
    height: '72%',
    border: 'line',
    tags: true,
    hidden: true,
    scrollable: true,
    alwaysScroll: true,
    style: {
      border: theme.focusedBorder,
      bg: 'black',
      fg: 'white',
    },
  });

  return {
    screen,
    datasetPanel,
    datasetList,
    taskPanel,
    youglishPanel,
    statusBar,
  };
}
