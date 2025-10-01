export async function fetchWithDelay(
    input: RequestInfo | URL,
    init: RequestInit,
    delayMs: number): Promise<Response> {
    if (delayMs > 0) {
        await sleep(delayMs);
    }

    return fetch(input, init);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

export interface FetchedPage {
    html: string;
    finalUrl: string;
    redirected: boolean;
}

export async function fetchPage(url: string, delayMs: number): Promise<FetchedPage> {
    const response = await fetchWithDelay(url, {
        method: 'GET',
        headers: {
            Accept: 'text/html,application/xhtml+xml',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:115.0) Gecko/20100101 Firefox/115.0',
        },
    }, delayMs);

    if (!response.ok) {
        throw new Error(`statut HTTP ${response.status}`);
    }

    const html = await response.text();
    return {
        html,
        finalUrl: response.url ?? url,
        redirected: response.redirected,
    };
}
