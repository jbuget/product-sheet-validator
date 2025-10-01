#!/usr/bin/env node
import { promises as fs } from 'fs';
import { dirname } from 'path';
import { Agent, setGlobalDispatcher } from 'undici';
import { parseCliArgs } from './cli';
import { fromCsvFile } from './urls';
import { validateUrls, type ValidationOutcome } from './validator';

const ANSI_GREEN = '\x1b[32m';
const ANSI_RED = '\x1b[31m';
const ANSI_BLUE = '\x1b[34m';
const ANSI_RESET = '\x1b[0m';

setGlobalDispatcher(new Agent({
  keepAliveTimeout: 10_000,
  keepAliveMaxTimeout: 60_000,
  pipelining: 1,
}));

async function writeResults(outputPath: string, outcomes: ValidationOutcome[]): Promise<void> {
  const rows = [
    ['URL', 'result', 'comments'],
    ...outcomes.map((outcome) => [outcome.url, outcome.result, outcome.comments]),
  ];
  const csv = serializeCsv(rows, ';');

  await fs.mkdir(dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, csv, 'utf8');
}

function serializeCsv(rows: string[][], delimiter: string): string {
  return rows
    .map((row) => row.map((value) => escapeCsvValue(value, delimiter)).join(delimiter))
    .join('\n');
}

function escapeCsvValue(value: string, delimiter: string): string {
  const needsQuoting = value.includes(delimiter) || value.includes('\n') || value.includes('"');
  if (!needsQuoting) {
    return value;
  }
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

interface ProgressReporter {
  onProcessed: () => void;
  finish: () => void;
}

function createProgressReporter(total: number, intervalMs = 10_000): ProgressReporter {
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

function logOutcome(outcome: ValidationOutcome): void {
  const status = outcome.result === 'OK'
    ? `${ANSI_GREEN}[OK]${ANSI_RESET}`
    : `${ANSI_RED}[KO]${ANSI_RESET}`;
  if (outcome.comments) {
    console.log(`${status} ${outcome.url} - ${outcome.comments}`);
  } else {
    console.log(`${status} ${outcome.url}`);
  }
}

async function run(): Promise<void> {
  try {
    const options = parseCliArgs(process.argv);
    const uniqueUrls = await fromCsvFile(options.inputPath);

    if (uniqueUrls.length === 0) {
      console.warn('Aucune URL valide trouvée dans le fichier d\'entrée.');
      process.exitCode = 1;
    }

    const outcomes: ValidationOutcome[] = [];

    const totalUnique = uniqueUrls.length;
    const progress = createProgressReporter(totalUnique, 10_000);
    let uniqueOutcomes: Map<string, ValidationOutcome> = new Map();

    try {
      uniqueOutcomes = await validateUrls(uniqueUrls, options.validatePdfLinks, options.delayMs, (outcome) => {
        progress.onProcessed();
        logOutcome(outcome);
      });
    } finally {
      progress.finish();
    }

    for (const url of uniqueUrls) {
      const outcome = uniqueOutcomes.get(url);
      if (!outcome) {
        const fallback: ValidationOutcome = {
          url,
          result: 'KO',
          comments: 'Validation indisponible',
        };
        outcomes.push(fallback);
        logOutcome(fallback);
        continue;
      }
      outcomes.push(outcome);
    }

    await writeResults(options.outputPath, outcomes);
    console.log(`\nRésultats enregistrés dans ${options.outputPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Erreur: ${message}`);
    process.exitCode = 1;
  }
}

void run();
