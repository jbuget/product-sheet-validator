import { promises as fs } from 'fs';
import { dirname } from 'path';
import type { ValidationOutcome } from './validator';

export async function writeResultsToCsvFile(
  outputPath: string,
  outcomes: ValidationOutcome[],
  delimiter = ';'
): Promise<void> {
  const rows = [
    ['URL', 'result', 'comments'],
    ...outcomes.map((outcome) => [outcome.url, outcome.result, outcome.comments]),
  ];
  const csv = serializeCsv(rows, delimiter);

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
