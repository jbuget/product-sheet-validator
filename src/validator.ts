import { load, type CheerioAPI, type Cheerio } from 'cheerio';
import type { Element } from 'domhandler';
import { renderProductPage, fetchWithDelay } from './fetch';

export interface ValidationOutcome {
    url: string;
    result: 'OK' | 'KO';
    comments: string;
}

const MAX_CONCURRENT_REQUESTS = 8;

export async function validateUrls(
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
    if (!isHttpUrl(url)) {
        return {
            url,
            result: 'KO',
            comments: 'URL invalide ou protocole non supporté',
        };
    }

    let page;

    try {
        page = await renderProductPage(url, delayMs);
    } catch (error) {
        const reason = error instanceof Error ? error.message : 'Erreur inconnue';
        return {
            url,
            result: 'KO',
            comments: `Échec du chargement de la page (${reason})`,
        };
    }

    if (!isSameProductUrl(url, page.finalUrl) || page.redirected) {
        const target = page.finalUrl;
        return {
            url,
            result: 'KO',
            comments: `Redirection vers ${target}`,
        };
    }

    const $ = load(page.html);

    const documentationSection = findDocumentationSection($);
    if (!documentationSection) {
        return {
            url,
            result: 'KO',
            comments: 'Section product-documentation absente (fiche de sécurité et technique manquantes)',
        };
    }

    const extraComments: string[] = [];

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

    if (extraComments.length > 0) {
        return {
            url,
            result: 'KO',
            comments: extraComments.join(' ; '),
        };
    }

    return {
        url,
        result: 'OK',
        comments: '',
    };
}

function isHttpUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (error) {
        return false;
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
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:115.0) Gecko/20100101 Firefox/115.0',
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
