import { Command, InvalidArgumentError } from 'commander';
import { resolve } from 'path/posix';

const DEFAULT_INPUT = 'input/products.csv';
const DEFAULT_OUTPUT = 'output/results.csv';
const DEFAULT_VALIDATE_PDF_LINKS = true;
const DEFAULT_FETCH_DELAY_MS = 200;

export interface CliOptions {
  inputPath: string;
  outputPath: string;
  validatePdfLinks: boolean;
  delayMs: number;
}

export function parseCliArgs(argv: string[]): CliOptions {
  const program = new Command();
  program
    .name('shopify-product-page-validator')
    .description('CLI pour valider la présence des fiches PDF sur les pages produits')
    .option('-i, --input <path>', "Fichier CSV d'entrée", DEFAULT_INPUT)
    .option('-o, --output <path>', 'Fichier CSV de sortie', DEFAULT_OUTPUT)
    .option('-d, --delay <ms>', "Délai entre les requêtes HTTP (ms)", DEFAULT_FETCH_DELAY_MS.toString())
    .option('--skip-pdf-validation', 'Désactive la vérification des liens PDF')
    .option('--pdf-validation', 'Force la vérification des liens PDF (valeur par défaut)')
    .helpOption('-h, --help', 'Affiche cette aide');

  program.parse(argv);
  const opts = program.opts<{
    input?: string;
    output?: string;
    skipPdfValidation?: boolean;
    pdfValidation?: boolean;
    delay?: string;
  }>();

  let validatePdfLinks = DEFAULT_VALIDATE_PDF_LINKS;
  if (opts.skipPdfValidation) {
    validatePdfLinks = false;
  }
  if (opts.pdfValidation) {
    validatePdfLinks = true;
  }

  const inputPath = opts.input ?? DEFAULT_INPUT;
  const outputPath = opts.output ?? DEFAULT_OUTPUT;
  const delayMs = parseDelay(opts.delay);

  return {
    inputPath: resolve(process.cwd(), inputPath),
    outputPath: resolve(process.cwd(), outputPath),
    validatePdfLinks,
    delayMs,
  };
}

export function parseDelay(value: string | undefined): number {
  if (!value) {
    return DEFAULT_FETCH_DELAY_MS;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InvalidArgumentError('La valeur du délai doit être un entier strictement positif.');
  }
  return parsed;
}
