import { getSafePublicPathname } from './search-url-safety.ts';
import { isStrictUuid } from './search-response-safety.ts';

export const NETWORK_SEARCH_ENDPOINT = 'https://acecore.net/api/network-search';

const MAX_TITLE_LENGTH = 240;
const MAX_SECTION_LENGTH = 240;
const MAX_EXCERPT_LENGTH = 500;
const MAX_LABEL_LENGTH = 100;
const MAX_URL_LENGTH = 500;
const MAX_RESULTS = 3;

const NETWORK_SOURCES = {
	acecore: { label: 'Acecore', origin: 'https://acecore.net' },
	systems: { label: 'Acecore Systems', origin: 'https://systems.acecore.net' },
	schools: { label: 'Acecore Schools', origin: 'https://schools.acecore.net' },
	wiki: { label: 'Aceserver WIKI', origin: 'https://asv-wiki.acecore.net' },
	portal: { label: 'Aceserver Portal', origin: 'https://asv.acecore.net' },
	'world-foundation': {
		label: 'World Foundation',
		origin: 'https://world-foundation.acecore.net',
	},
} as const;

export type NetworkSearchSource = keyof typeof NETWORK_SOURCES;

export type NetworkSearchResult = {
	excerpt: string;
	rank: number;
	section: string;
	source: NetworkSearchSource;
	sourceLabel: string;
	title: string;
	url: string;
};

type Fetcher = typeof fetch;

export async function fetchNetworkSearch(
	query: string,
	currentSource: NetworkSearchSource,
	signal: AbortSignal,
	fetcher: Fetcher = fetch,
): Promise<NetworkSearchResult[]> {
	const response = await fetcher(NETWORK_SEARCH_ENDPOINT, {
		method: 'POST',
		credentials: 'omit',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ query, locale: 'ja' }),
		signal,
	});

	if (!response.ok) return [];
	return parseNetworkSearchResults(await response.json(), currentSource);
}

export function parseNetworkSearchResults(
	payload: unknown,
	currentSource: NetworkSearchSource,
): NetworkSearchResult[] {
	if (
		!isRecord(payload) ||
		payload.ok !== true ||
		!isStrictUuid(payload.requestId) ||
		!Array.isArray(payload.results)
	) {
		return [];
	}

	const seenUrls = new Set<string>();
	const parsed: NetworkSearchResult[] = [];
	for (const value of payload.results) {
		const result = parseNetworkSearchResult(value, currentSource);
		if (!result || seenUrls.has(result.url)) continue;

		seenUrls.add(result.url);
		parsed.push(result);
		if (parsed.length >= MAX_RESULTS) break;
	}

	return parsed;
}

function parseNetworkSearchResult(
	value: unknown,
	currentSource: NetworkSearchSource,
): NetworkSearchResult | null {
	if (!isRecord(value)) return null;

	const source = readSource(value.source);
	if (!source || source === currentSource) return null;

	const title = readText(value.title, MAX_TITLE_LENGTH, true);
	const section = readText(value.section, MAX_SECTION_LENGTH, false);
	const excerpt = readText(value.excerpt, MAX_EXCERPT_LENGTH, false);
	const sourceLabel = readText(value.sourceLabel, MAX_LABEL_LENGTH, true);
	const rank = value.rank;
	const url = readSafeUrl(value.url, source);
	if (
		!title ||
		!sourceLabel ||
		sourceLabel !== NETWORK_SOURCES[source].label ||
		!url ||
		!Number.isInteger(rank) ||
		rank < 1 ||
		rank > MAX_RESULTS
	) {
		return null;
	}

	return { excerpt, rank, section, source, sourceLabel, title, url };
}

function readSource(value: unknown): NetworkSearchSource | null {
	return typeof value === 'string' && Object.hasOwn(NETWORK_SOURCES, value)
		? (value as NetworkSearchSource)
		: null;
}

function readText(
	value: unknown,
	maximumLength: number,
	required: boolean,
): string {
	if (typeof value !== 'string') return '';

	const text = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
	if (
		[...text].length > maximumLength ||
		/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)
	) {
		return '';
	}

	return required && !text ? '' : text;
}

function readSafeUrl(
	value: unknown,
	source: NetworkSearchSource,
): string | null {
	if (typeof value !== 'string') return null;

	const rawUrl = value;
	if (
		!rawUrl ||
		[...rawUrl].length > MAX_URL_LENGTH ||
		rawUrl.includes('\\') ||
		rawUrl.includes('?') ||
		rawUrl.includes('#') ||
		/[\s<>"']/u.test(rawUrl) ||
		/[\u0000-\u001f\u007f]/u.test(rawUrl) ||
		/%(?:2f|5c)/iu.test(rawUrl)
	) {
		return null;
	}

	const expectedOrigin = NETWORK_SOURCES[source].origin;
	const rawPathname = readRawPathname(rawUrl, expectedOrigin);
	const pathname = rawPathname ? getSafePublicPathname(rawPathname) : null;
	if (!pathname) return null;

	try {
		const url = new URL(rawUrl);
		if (
			url.protocol !== 'https:' ||
			url.origin !== expectedOrigin ||
			url.username ||
			url.password ||
			url.port ||
			url.search ||
			url.hash ||
			!pathname.startsWith('/') ||
			pathname.startsWith('//')
		) {
			return null;
		}

		if (
			(source === 'wiki' && !pathname.startsWith('/article/')) ||
			(source === 'portal' &&
				(/^\/(?:admin|api)(?:\/|$)/u.test(pathname) ||
					[
						'/vector-corpus.json',
						'/404',
						'/404/',
						'/404.html',
						'/404.html/',
					].includes(pathname)))
		) {
			return null;
		}

		return new URL(pathname, expectedOrigin).href;
	} catch {
		return null;
	}
}

function readRawPathname(value: string, origin: string): string | null {
	if (value === origin) return '/';
	return value.startsWith(`${origin}/`) ? value.slice(origin.length) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
