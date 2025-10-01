import { promises as fs } from 'fs';

export async function readUrlsfromCsvFile(filePath: string): Promise<string[]> {
  const content = await fs.readFile(filePath, 'utf8');
  const records = parseCsv(content);

  if (records.length === 0) {
    throw new Error('Le fichier CSV ne contient aucune donnée');
  }

  const header = records[0];
  const dataRows = records.slice(1);
  const urlColumnIndex = findUrlColumnIndex(header);
  if (urlColumnIndex === -1) {
    throw new Error('Impossible de trouver une colonne "URL" dans le CSV');
  }

  const seenUrls = new Set<string>();
  const uniqueUrls: string[] = [];

  for (const row of dataRows) {
    const rawUrl = row[urlColumnIndex];
    const url = (rawUrl ?? '').trim();
    if (!url) {
      continue;
    }
    if (!seenUrls.has(url)) {
      seenUrls.add(url);
      uniqueUrls.push(url);
    }
  }

  return uniqueUrls;
}

function parseCsv(content: string): string[][] {
  const lines: string[][] = [];
  const sanitized = content.replace(/\r\n/g, '\n');
  const firstNonEmptyLine = sanitized.split('\n').find((line) => line.trim().length > 0) ?? '';
  const delimiter = detectDelimiter(firstNonEmptyLine);

  let currentValue = '';
  let currentRow: string[] = [];
  let insideQuotes = false;

  for (let i = 0; i < sanitized.length; i += 1) {
    const char = sanitized[i];

    if (char === '"') {
      if (insideQuotes && sanitized[i + 1] === '"') {
        currentValue += '"';
        i += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (!insideQuotes && char === delimiter) {
      currentRow.push(currentValue);
      currentValue = '';
      continue;
    }

    if (!insideQuotes && char === '\n') {
      currentRow.push(currentValue);
      lines.push(currentRow);
      currentRow = [];
      currentValue = '';
      continue;
    }

    currentValue += char;
  }

  if (insideQuotes) {
    throw new Error('Le fichier CSV est mal formé: guillemets non fermés');
  }

  if (currentValue.length > 0 || currentRow.length > 0) {
    currentRow.push(currentValue);
    lines.push(currentRow);
  }

  return lines.filter((row) => row.some((value) => value.trim().length > 0));
}

function detectDelimiter(firstLine: string): string {
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  const semicolonCount = (firstLine.match(/;/g) ?? []).length;
  if (semicolonCount > commaCount) {
    return ';';
  }
  if (commaCount > 0) {
    return ',';
  }
  return ';';
}

function findUrlColumnIndex(header: string[]): number {
  return header.findIndex((column) => column.trim().toLowerCase() === 'url');
}
