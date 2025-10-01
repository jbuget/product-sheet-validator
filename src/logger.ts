import type { ValidationOutcome } from './validator';

const ANSI_GREEN = '\x1b[32m';
const ANSI_RED = '\x1b[31m';
const ANSI_RESET = '\x1b[0m';

export function logOutcome(outcome: ValidationOutcome): void {
  const status = outcome.result === 'OK'
    ? `${ANSI_GREEN}[OK]${ANSI_RESET}`
    : `${ANSI_RED}[KO]${ANSI_RESET}`;

  if (outcome.comments) {
    console.log(`${status} ${outcome.url} - ${outcome.comments}`);
  } else {
    console.log(`${status} ${outcome.url}`);
  }
}
