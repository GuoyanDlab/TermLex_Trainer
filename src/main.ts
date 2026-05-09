import path from 'node:path';
import { App } from './app';
import { loadDotEnv } from './env/load-env';

async function main(): Promise<void> {
  const rootDir = path.resolve(process.cwd());
  await loadDotEnv(rootDir);
  const app = new App(rootDir);
  await app.init();
}

main().catch((error) => {
  // Keep startup errors readable in plain terminal output.
  // eslint-disable-next-line no-console
  console.error('[startup error]', error);
  process.exit(1);
});
