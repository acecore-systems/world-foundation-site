import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { load } from 'cheerio';

import {
	SEARCH_CHUNK_MAXIMUM_CHARACTERS,
	SEARCH_CHUNK_OVERLAP_CHARACTERS,
	SEARCH_CHUNK_TARGET_CHARACTERS,
	SEARCH_CORPUS_SCHEMA_VERSION,
	SEARCH_DISTANCE_METRIC,
	SEARCH_EMBEDDING_DIMENSIONS,
	SEARCH_EMBEDDING_MODEL,
	SEARCH_VECTOR_LIMIT,
	createSearchCorpusVersion,
	createSearchVectorId,
} from './search-contract.mjs';

export {
	SEARCH_CHUNK_MAXIMUM_CHARACTERS,
	SEARCH_CHUNK_OVERLAP_CHARACTERS,
	SEARCH_CHUNK_TARGET_CHARACTERS,
	SEARCH_CORPUS_SCHEMA_VERSION,
	SEARCH_DISTANCE_METRIC,
	SEARCH_EMBEDDING_DIMENSIONS,
	SEARCH_EMBEDDING_MODEL,
	SEARCH_VECTOR_LIMIT,
	createSearchVectorId,
} from './search-contract.mjs';

const DEFAULT_DIST_DIR = resolve('dist');
const DEFAULT_MANIFEST_FILE = resolve('.vectorize/content-manifest.json');
const DEFAULT_OUTPUT_FILE = resolve('.vectorize/corpus.json');
const MANIFEST_SCHEMA_VERSION = 1;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
const SUPPORTED_LOCALES = ['ja', 'en'];
const execFileAsync = promisify(execFile);

const CONTENT_SELECTORS = [
	'h1',
	'h2',
	'h3',
	'p',
	'li',
	'blockquote',
	'dt',
	'dd',
	'td',
	'th',
].join(',');

const REMOVE_SELECTORS = [
	'[data-pagefind-ignore]',
	'[aria-hidden="true"]',
	'script',
	'style',
	'noscript',
	'template',
	'svg',
	'canvas',
	'form',
	'button',
	'nav',
	'aside',
	'footer',
	'pre',
].join(',');

export async function buildSearchCorpus({
	distDir = DEFAULT_DIST_DIR,
	manifestFile = DEFAULT_MANIFEST_FILE,
	outputFile = DEFAULT_OUTPUT_FILE,
	siteCommit,
	write = true,
} = {}) {
	const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
	validateContentManifest(manifest);

	const resolvedSiteCommit = await resolveSiteCommit(siteCommit);
	const documents = [];

	for (const route of manifest.routes) {
		if (!route.searchable) continue;

		const htmlFile = routeUrlToHtmlFile(route.url, distDir);
		let html;
		try {
			html = await readFile(htmlFile, 'utf8');
		} catch (error) {
			throw new Error(
				`Searchable route ${route.url} is missing built HTML at ${htmlFile}.`,
				{ cause: error },
			);
		}

		const document = extractSearchDocument(html, route);
		if (!document) {
			throw new Error(
				`Searchable route ${route.url} does not contain usable main[data-pagefind-body] content.`,
			);
		}
		documents.push(document);
	}

	documents.sort((a, b) => {
		const byUrl = a.url.localeCompare(b.url);
		return byUrl || a.locale.localeCompare(b.locale);
	});

	const chunks = documents.flatMap((document) =>
		chunkSearchDocument(document),
	);
	if (chunks.length > SEARCH_VECTOR_LIMIT) {
		throw new Error(
			`Search corpus has ${chunks.length} vectors; the configured limit is ${SEARCH_VECTOR_LIMIT}.`,
		);
	}

	const ids = new Set();
	for (const chunk of chunks) {
		if (ids.has(chunk.id)) {
			throw new Error(`Search corpus produced duplicate vector id ${chunk.id}.`);
		}
		ids.add(chunk.id);
	}

	const localeCounts = Object.fromEntries(
		SUPPORTED_LOCALES.map((locale) => [
			locale,
			chunks.filter((chunk) => chunk.namespace === locale).length,
		]),
	);
	const version = createSearchCorpusVersion({
		siteCommit: resolvedSiteCommit,
		contentCommit: manifest.contentCommit,
		vectorIds: chunks.map(({ id }) => id),
	});
	const corpus = {
		schemaVersion: SEARCH_CORPUS_SCHEMA_VERSION,
		version,
		siteCommit: resolvedSiteCommit,
		contentCommit: manifest.contentCommit.toLowerCase(),
		embedding: {
			model: SEARCH_EMBEDDING_MODEL,
			dimensions: SEARCH_EMBEDDING_DIMENSIONS,
			metric: SEARCH_DISTANCE_METRIC,
		},
		chunking: {
			targetCharacters: SEARCH_CHUNK_TARGET_CHARACTERS,
			maximumCharacters: SEARCH_CHUNK_MAXIMUM_CHARACTERS,
			overlapCharacters: SEARCH_CHUNK_OVERLAP_CHARACTERS,
		},
		sourceCount: documents.length,
		vectorCount: chunks.length,
		localeCounts,
		chunks,
	};

	if (write) {
		await mkdir(dirname(outputFile), { recursive: true });
		await writeFile(outputFile, `${JSON.stringify(corpus, null, 2)}\n`, 'utf8');
	}

	return corpus;
}

export function validateContentManifest(manifest) {
	if (
		manifest?.schemaVersion !== MANIFEST_SCHEMA_VERSION ||
		!COMMIT_PATTERN.test(manifest?.contentCommit || '') ||
		!Array.isArray(manifest?.routes)
	) {
		throw new Error(
			'Content manifest must use schemaVersion 1, a 40-character contentCommit, and a routes array.',
		);
	}

	const urls = new Set();
	for (const route of manifest.routes) {
		if (
			!route ||
			typeof route.url !== 'string' ||
			!SUPPORTED_LOCALES.includes(route.locale) ||
			typeof route.searchable !== 'boolean'
		) {
			throw new Error('Content manifest contains an invalid route.');
		}

		const normalizedUrl = normalizeRouteUrl(route.url);
		if (normalizedUrl !== route.url) {
			throw new Error(
				`Content manifest route must be a normalized root-relative URL: ${route.url}`,
			);
		}
		if (urls.has(route.url)) {
			throw new Error(`Content manifest contains duplicate route ${route.url}.`);
		}
		urls.add(route.url);
	}
}

export async function resolveSiteCommit(explicitCommit) {
	const candidate =
		explicitCommit ||
		process.env.COMMIT_SHA ||
		process.env.CF_PAGES_COMMIT_SHA ||
		(await readGitHead());
	if (!COMMIT_PATTERN.test(candidate || '')) {
		throw new Error(
			'Site commit must be a full 40-character Git SHA from COMMIT_SHA, CF_PAGES_COMMIT_SHA, or git HEAD.',
		);
	}
	return candidate.toLowerCase();
}

export function extractSearchDocument(html, route) {
	const $ = load(html);
	const contentRoot = $('main[data-pagefind-body]').first();
	if (contentRoot.length === 0) return null;

	const root = contentRoot.clone();
	root.find(REMOVE_SELECTORS).remove();
	removeSourceEditBlockquote($, root);

	const title = normalizeText(
		root.find('h1').first().text() ||
			$('meta[property="og:title"]').attr('content') ||
			$('title').text(),
	);
	if (!title) return null;

	const blocks = collectContentBlocks($, root, title);
	if (blocks.length === 0) return null;

	return {
		url: route.url,
		locale: route.locale,
		title,
		blocks,
	};
}

export function chunkSearchDocument(document) {
	const groups = [];
	let current = [];

	for (const block of document.blocks) {
		const blockLimit = Math.max(
			320,
			SEARCH_CHUNK_MAXIMUM_CHARACTERS -
				document.title.length -
				block.heading.length -
				SEARCH_CHUNK_OVERLAP_CHARACTERS -
				4,
		);

		for (const part of splitLongText(block.text, blockLimit)) {
			const next = { heading: block.heading, text: part };
			const candidate = [...current, next];
			const candidateText = composeChunkText(document, candidate);
			const currentBodyLength = current.reduce(
				(total, item, index) =>
					total + item.text.length + (index > 0 ? 1 : 0),
				0,
			);

			if (
				current.length > 0 &&
				(currentBodyLength + 1 + part.length >
					SEARCH_CHUNK_TARGET_CHARACTERS ||
					candidateText.length > SEARCH_CHUNK_MAXIMUM_CHARACTERS)
			) {
				groups.push(current);
				current = buildOverlap(current);
				if (
					composeChunkText(document, [...current, next]).length >
					SEARCH_CHUNK_MAXIMUM_CHARACTERS
				) {
					current = [];
				}
			}

			current.push(next);
		}
	}

	if (current.length > 0) groups.push(current);

	return groups.map((group, index) => {
		const section =
			[...group].reverse().find(({ heading }) => heading)?.heading ||
			document.title;
		const body = group.map(({ text }) => text).join('\n');
		const text = composeChunkText(document, group);
		if (text.length > SEARCH_CHUNK_MAXIMUM_CHARACTERS) {
			throw new Error(
				`Search chunk exceeds ${SEARCH_CHUNK_MAXIMUM_CHARACTERS} characters: ${document.url}`,
			);
		}

		const id = createSearchVectorId({
			locale: document.locale,
			url: document.url,
			index,
			text,
		});
		return {
			id,
			namespace: document.locale,
			text,
			metadata: {
				url: document.url,
				title: document.title,
				section,
				excerpt: createExcerpt(body),
				locale: document.locale,
			},
		};
	});
}

function collectContentBlocks($, root, title) {
	const blocks = [];
	let currentHeading = title;
	let previousText = '';

	root.find(CONTENT_SELECTORS).each((_index, element) => {
		const tagName = String(element.tagName || '').toLowerCase();
		const text = normalizeText($(element).text());
		if (!text || text === previousText) return;

		previousText = text;
		if (/^h[1-3]$/.test(tagName)) {
			currentHeading = text;
			return;
		}

		blocks.push({ heading: currentHeading, text });
	});

	return blocks;
}

function removeSourceEditBlockquote($, root) {
	const first = root.find('blockquote').first();
	if (first.length === 0) return;

	const text = normalizeText(first.text()).toLowerCase();
	const hrefs = first
		.find('a')
		.toArray()
		.map((element) => String($(element).attr('href') || ''));
	const hasSourceLabel =
		text.includes('原文') ||
		text.includes('source') ||
		text.includes('githubで原文を見る') ||
		text.includes('view on github');
	const hasEditLabel =
		text.includes('編集を提案') || text.includes('propose an edit');
	const hasSourceLink = hrefs.some((href) => /github\.com\/.+\/blob\//i.test(href));
	const hasEditLink = hrefs.some((href) => /github\.com\/.+\/edit\//i.test(href));

	if ((hasSourceLabel && hasEditLabel) || (hasSourceLink && hasEditLink)) {
		first.remove();
	}
}

function splitLongText(text, limit) {
	if (text.length <= limit) return [text];

	const sentences = text.split(/(?<=[。！？.!?])\s*/u).filter(Boolean);
	const parts = [];
	let current = '';

	for (const sentence of sentences) {
		if (sentence.length > limit) {
			if (current) {
				parts.push(current);
				current = '';
			}
			for (let index = 0; index < sentence.length; index += limit) {
				parts.push(sentence.slice(index, index + limit));
			}
			continue;
		}

		const candidate = current ? `${current} ${sentence}` : sentence;
		if (candidate.length > limit) {
			parts.push(current);
			current = sentence;
		} else {
			current = candidate;
		}
	}

	if (current) parts.push(current);
	return parts;
}

function buildOverlap(blocks) {
	const overlap = [];
	let remaining = SEARCH_CHUNK_OVERLAP_CHARACTERS;

	for (const block of [...blocks].reverse()) {
		if (remaining <= 0) break;
		if (block.text.length <= remaining) {
			overlap.unshift(block);
			remaining -= block.text.length;
			continue;
		}
		overlap.unshift({
			...block,
			text: block.text.slice(-remaining),
		});
		remaining = 0;
	}

	return overlap;
}

function composeChunkText(document, group) {
	const section =
		[...group].reverse().find(({ heading }) => heading)?.heading ||
		document.title;
	const body = group.map(({ text }) => text).join('\n');
	return normalizeText(
		[document.title, section !== document.title ? section : '', body]
			.filter(Boolean)
			.join('\n'),
	);
}

function createExcerpt(text) {
	const normalized = normalizeText(text);
	if (normalized.length <= 220) return normalized;
	return `${normalized.slice(0, 219).trimEnd()}…`;
}

function routeUrlToHtmlFile(routeUrl, distDir) {
	const normalizedUrl = normalizeRouteUrl(routeUrl);
	const decodedPath = decodeURIComponent(normalizedUrl);
	const relativePath = decodedPath.replace(/^\/+/, '');

	if (!relativePath) return resolve(distDir, 'index.html');
	if (relativePath.endsWith('/')) {
		return resolve(distDir, relativePath, 'index.html');
	}
	if (relativePath.endsWith('.html')) return resolve(distDir, relativePath);
	return resolve(distDir, relativePath, 'index.html');
}

function normalizeRouteUrl(value) {
	let parsed;
	try {
		parsed = new URL(value, 'https://world-foundation.invalid');
	} catch {
		throw new Error(`Invalid route URL: ${value}`);
	}
	if (
		parsed.origin !== 'https://world-foundation.invalid' ||
		parsed.search ||
		parsed.hash
	) {
		throw new Error(`Route URL must be root-relative without query or hash: ${value}`);
	}

	const decodedSegments = parsed.pathname
		.split('/')
		.filter(Boolean)
		.map((segment) => decodeURIComponent(segment));
	if (
		decodedSegments.some(
			(segment) =>
				segment === '.' ||
				segment === '..' ||
				segment.includes('/') ||
				segment.includes('\\'),
		)
	) {
		throw new Error(`Route URL must not contain traversal segments: ${value}`);
	}

	let path = `/${decodedSegments.map(encodeURIComponent).join('/')}`;
	if (path !== '/' && !path.endsWith('.html')) path += '/';
	return path;
}

function normalizeText(value) {
	return String(value || '')
		.normalize('NFKC')
		.replace(/\s+/gu, ' ')
		.trim();
}

async function readGitHead() {
	try {
		const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
			encoding: 'utf8',
			windowsHide: true,
		});
		return stdout.trim();
	} catch (error) {
		throw new Error('Unable to derive site commit from git HEAD.', {
			cause: error,
		});
	}
}

function isDirectExecution() {
	if (!process.argv[1]) return false;
	return (
		resolve(process.argv[1]).toLowerCase() ===
		fileURLToPath(import.meta.url).toLowerCase()
	);
}

if (isDirectExecution()) {
	const corpus = await buildSearchCorpus();
	console.log(
		JSON.stringify({
			event: 'search_corpus_built',
			version: corpus.version,
			siteCommit: corpus.siteCommit,
			contentCommit: corpus.contentCommit,
			sources: corpus.sourceCount,
			vectors: corpus.vectorCount,
			locales: corpus.localeCounts,
		}),
	);
}
