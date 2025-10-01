#!/usr/bin/env node
import { promises as fs } from 'fs';
import { dirname } from 'path';
import { fromURL, type CheerioAPI, type Cheerio } from 'cheerio';
import type { Element } from 'domhandler';
import { Agent, setGlobalDispatcher } from 'undici';
import { parseCliArgs } from './cli';
import { fetchPage, fetchWithDelay } from './fetch';
import { readUrlsfromCsvFile } from './urls';

interface ValidationOutcome {
  url: string;
  result: 'OK' | 'KO';
  comments: string;
}

const MAX_CONCURRENT_REQUESTS = 16;
const ANSI_GREEN = '\x1b[32m';
const ANSI_RED = '\x1b[31m';
const ANSI_BLUE = '\x1b[34m';
const ANSI_RESET = '\x1b[0m';

setGlobalDispatcher(new Agent({
  keepAliveTimeout: 10_000,
  keepAliveMaxTimeout: 60_000,
  pipelining: 1,
}));

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

async function validateUrls(
  urls: string[],
  validatePdfLinks: boolean,
  delayMs: number,
  onOutcome?: (outcome: ValidationOutcome) => void,
): Promise<Map<string, ValidationOutcome>> {
  const results = new Map<string, ValidationOutcome>();
  if (urls.length === 0) {
    return results;
  }

  let currentIndex = 0;
  const workerCount = Math.min(MAX_CONCURRENT_REQUESTS, urls.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      if (currentIndex >= urls.length) {
        break;
      }
      const index = currentIndex;
      currentIndex += 1;
      const url = urls[index];
      const outcome = await validateProductPage(url, validatePdfLinks, delayMs);
      results.set(url, outcome);
      if (onOutcome) {
        onOutcome(outcome);
      }
    }
  });

  await Promise.all(workers);
  return results;
}

async function validateProductPage(
  url: string,
  validatePdfLinks: boolean,
  delayMs: number,
): Promise<ValidationOutcome> {
  // Vérifier que l'URL est valide et utilise HTTP ou HTTPS
  if (!isHttpUrl(url)) {
    return {
      url,
      result: 'KO',
      comments: 'URL invalide ou protocole non supporté',
    };
  }

  try {
    // Récupérer la page HTML
    const page = await fetchPage(url, delayMs);

    // Vérifier qu'il n'y a pas eu de redirection vers un autre produit ou la page d'accueil
    if (!isSameProductUrl(url, page.finalUrl) || page.redirected) {
      const target = page.finalUrl;
      return {
        url,
        result: 'KO',
        comments: `Redirection vers ${target}`
      };
    }

    // Charger le code HTML via cheerio.fromURL avec des en-têtes alignés
    const $ = await fromURL(url, {
      requestOptions: {
        method: 'GET',
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': 'shopify-page-validator/1.0',
        },
      },
    });

    const extraComments: string[] = [];

    // Vérifier la présence de la section de documentation qui contient les liens PDF
    const documentationSection = findDocumentationSection($);
    if (!documentationSection) {
      return {
        url,
        result: 'KO',
        comments: `Section product-documentation absente (fiche de sécurité et technique manquantes)`,
      };
    }

    // Vérifier la présence du lien vers la fiche de données de sécurité
    const safetyHref = findDocumentationLink(documentationSection, [
      'product-documentation__link',
      'product-documentation__link--safety-data-sheet',
    ]);
    const hasSafetySheet = Boolean(safetyHref);
    if (hasSafetySheet) {
      if (safetyHref && validatePdfLinks) {
        const safetyValid = await isValidPdfLink(page.finalUrl, safetyHref, delayMs);
        if (!safetyValid) {
          extraComments.push('Lien vers la fiche de sécurité invalide');
        }
      }
    } else {
      extraComments.push('Fiche de sécurité manquante');
    }

    // Vérifier la présence du lien vers la fiche technique
    const technicalHref = findDocumentationLink(documentationSection, [
      'product-documentation__link',
      'product-documentation__link--technical-data-sheet',
    ]);
    const hasTechnicalSheet = Boolean(technicalHref);
    if (hasTechnicalSheet) {
      if (technicalHref && validatePdfLinks) {
        const technicalValid = await isValidPdfLink(page.finalUrl, technicalHref, delayMs);
        if (!technicalValid) {
          extraComments.push('Lien vers la fiche technique invalide');
        }
      }
    } else {
      extraComments.push('Fiche technique manquante');
    }

    // Résultat final
    if (extraComments.length > 0) {
      return {
        url,
        result: 'KO',
        comments: extraComments.join(' ; '),
      };
    } else {
      return {
        url,
        result: 'OK',
        comments: '',
      };
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Erreur inconnue';
    return {
      url,
      result: 'KO',
      comments: `Échec du chargement de la page (${reason})`,
    };
  }
}

function isSameProductUrl(requestedUrl: string, finalUrl: string): boolean {
  try {
    const requested = new URL(requestedUrl);
    const final = new URL(finalUrl);

    if (requested.hostname !== final.hostname) {
      return false;
    }

    return normalizePath(requested.pathname) === normalizePath(final.pathname);
  } catch (error) {
    return false;
  }
}

function normalizePath(pathname: string): string {
  if (pathname === '/') {
    return pathname;
  }
  return pathname.replace(/\/+/g, '/').replace(/\/$/, '').toLowerCase();
}

function findDocumentationSection($: CheerioAPI): Cheerio<Element> | null {
  const section = $('.page__content.rte.text-subtext.product-documentation').first();
  return section.length > 0 ? (section as Cheerio<Element>) : null;
}

function findDocumentationLink(
  section: Cheerio<Element>,
  requiredClasses: string[],
): string | null {
  const link = section
    .children('a')
    .filter((_, element: Element) => {
      if (element.type !== 'tag') {
        return false;
      }
      const classAttr = element.attribs?.class;
      if (!classAttr) {
        return false;
      }
      const classNames = classAttr.split(/\s+/).filter(Boolean);
      return requiredClasses.every((className) => classNames.includes(className));
    })
    .first() as Cheerio<Element>;

  if (link.length === 0) {
    return null;
  }

  const href = link.attr('href')?.trim();
  return href && href.length > 0 ? href : null;
}

async function isValidPdfLink(baseUrl: string, href: string, delayMs: number): Promise<boolean> {
  try {
    const absoluteUrl = resolveUrl(baseUrl, href);
    const response = await fetchWithDelay(absoluteUrl, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'shopify-page-validator/1.0',
      },
    }, delayMs);
    if (!response.ok) {
      return false;
    }
    const contentType = response.headers.get('content-type') ?? '';
    const contentDisposition = response.headers.get('content-disposition') ?? '';
    const finalUrl = response.url ?? absoluteUrl;
    const isPdfHeader = contentType.toLowerCase().includes('application/pdf')
      || contentDisposition.toLowerCase().includes('application/pdf')
      || contentDisposition.toLowerCase().includes('.pdf');
    const isPdfUrl = /\.pdf(?:[?#]|$)/i.test(finalUrl);
    return isPdfHeader || isPdfUrl;
  } catch (error) {
    return false;
  }
}

function resolveUrl(baseUrl: string, maybeRelative: string): string {
  try {
    return new URL(maybeRelative, baseUrl).toString();
  } catch (error) {
    return maybeRelative;
  }
}

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
    const uniqueUrls = await readUrlsfromCsvFile(options.inputPath);

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
