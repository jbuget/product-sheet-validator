const ANSI_BLUE = '\x1b[34m';
const ANSI_RESET = '\x1b[0m';

export interface ProgressReporter {
  onProcessed: () => void;
  finish: () => void;
}

export function createProgressReporter(total: number, intervalMs = 10_000): ProgressReporter {
  let processed = 0;
  const startTime = Date.now();
  let finished = false;

  const logProgress = (isFinal: boolean): void => {
    const tag = `${ANSI_BLUE}[progress]${ANSI_RESET}`;
    const elapsedMs = Date.now() - startTime;
    const percentage = total === 0 ? 100 : Math.min(100, (processed / total) * 100);
    const elapsedStr = formatDuration(elapsedMs);
    const remainingMs = processed === 0
      ? null
      : Math.max(0, Math.round((elapsedMs / processed) * (total - processed)));
    const remainingStr = remainingMs === null ? 'indéterminé' : formatDuration(remainingMs);

    if (isFinal) {
      console.log(`\n${tag} ${processed}/${total} (${percentage.toFixed(1)}%) - temps total ${elapsedStr}\n`);
    } else {
      console.log(`\n${tag} ${processed}/${total} (${percentage.toFixed(1)}%) - temps écoulé ${elapsedStr} - temps restant estimé ${remainingStr}\n`);
    }
  };

  const timer = setInterval(() => {
    if (finished) {
      return;
    }
    logProgress(false);
  }, intervalMs);

  return {
    onProcessed: () => {
      processed += 1;
    },
    finish: () => {
      if (finished) {
        return;
      }
      finished = true;
      clearInterval(timer);
      logProgress(true);
    },
  };
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
