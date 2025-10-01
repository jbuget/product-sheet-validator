#!/usr/bin/env node
import { Agent, setGlobalDispatcher } from 'undici';
import { parseCliArgs } from './cli';
import { fromCsvFile } from './urls';
import { writeResultsToCsvFile } from './results';
import { createProgressReporter } from './progress';
import { logOutcome } from './logger';
import { shutdownBrowser } from './fetch';
import { validateUrls, type ValidationOutcome } from './validator';

setGlobalDispatcher(new Agent({
  keepAliveTimeout: 10_000,
  keepAliveMaxTimeout: 60_000,
  pipelining: 1,
}));

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

    await writeResultsToCsvFile(options.outputPath, outcomes);
    console.log(`\nRésultats enregistrés dans ${options.outputPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Erreur: ${message}`);
    process.exitCode = 1;
  } finally {
    await shutdownBrowser();
  }
}

void run();
