import { startApp } from './app/App';

const container = document.getElementById('app');
if (!container) throw new Error('#app missing');

startApp(container).catch((err: unknown) => {
  console.error(err);
  container.textContent = `PROPWASH failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
