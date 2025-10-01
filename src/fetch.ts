import { chromium, type Browser } from 'playwright';

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 500;
const JITTER_RATIO = 0.2;
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:115.0) Gecko/20100101 Firefox/115.0';

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true });
  }
  return browserPromise;
}

export async function shutdownBrowser(): Promise<void> {
  if (!browserPromise) {
    return;
  }
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch (error) {
    // ignore shutdown errors
  } finally {
    browserPromise = null;
  }
}

export interface FetchedPage {
  html: string;
  finalUrl: string;
  redirected: boolean;
}

export async function fetchWithDelay(
  input: RequestInfo | URL,
  init: RequestInit,
  delayMs: number,
): Promise<Response> {
  if (delayMs > 0) {
    await sleep(delayMs);
  }

  return fetch(input, init);
}

export async function fetchPage(url: string, delayMs: number): Promise<FetchedPage> {
  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt < MAX_ATTEMPTS) {
    attempt += 1;

    try {
      const response = await fetchWithDelay(url, {
        method: 'GET',
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': BROWSER_USER_AGENT,
        },
      }, delayMs);

      if (response.ok) {
        const html = await response.text();
        return {
          html,
          finalUrl: response.url ?? url,
          redirected: response.redirected,
        };
      }

      const shouldRetry = response.status === 429 || (response.status >= 500 && response.status < 600);
      if (!shouldRetry) {
        throw new Error(`statut HTTP ${response.status}`);
      }

      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterSeconds = retryAfterHeader ? Number.parseFloat(retryAfterHeader) : NaN;
      const baseDelay = Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1000 : BASE_BACKOFF_MS * 2 ** (attempt - 1);
      const jitter = baseDelay * JITTER_RATIO * Math.random();
      await sleep(baseDelay + jitter);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= MAX_ATTEMPTS) {
        break;
      }
      const backoff = BASE_BACKOFF_MS * 2 ** (attempt - 1);
      const jitter = backoff * JITTER_RATIO * Math.random();
      await sleep(backoff + jitter);
    }
  }

  throw lastError ?? new Error('Requête échouée');
}

export async function renderProductPage(url: string, delayMs: number): Promise<FetchedPage> {
  if (delayMs > 0) {
    await sleep(delayMs);
  }

  const browser = await getBrowser();
  const context = await browser.newContext({ userAgent: BROWSER_USER_AGENT });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
    const finalUrl = page.url();
    const html = await page.content();
    return {
      html,
      finalUrl,
      redirected: finalUrl !== url,
    };
  } finally {
    await context.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
