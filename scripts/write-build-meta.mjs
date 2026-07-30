import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
const CORPUS_VERSION_PATTERN = /^[0-9a-f]{20}$/i;
const DEFAULT_CORPUS_FILE = resolve('.vectorize/corpus.json');
const DEFAULT_OUTPUT_FILE = resolve(
	'dist/.well-known/world-foundation-build.json',
);

export function createBuildMetadata(corpus) {
	const siteCommit = normalizeCommit(corpus?.siteCommit, 'site');
	const contentCommit = normalizeCommit(corpus?.contentCommit, 'content');
	const searchCorpusVersion = String(corpus?.version || '')
		.trim()
		.toLowerCase();

	if (!CORPUS_VERSION_PATTERN.test(searchCorpusVersion)) {
		throw new Error(
			'Search corpus must contain a 20-character hexadecimal version.',
		);
	}

	return {
		schemaVersion: 1,
		siteCommit,
		contentCommit,
		searchCorpusVersion,
	};
}

export async function writeBuildMetadata({
	corpusFile = DEFAULT_CORPUS_FILE,
	outputFile = DEFAULT_OUTPUT_FILE,
} = {}) {
	const corpus = JSON.parse(await readFile(corpusFile, 'utf8'));
	const metadata = createBuildMetadata(corpus);

	await mkdir(dirname(outputFile), { recursive: true });
	await writeFile(outputFile, `${JSON.stringify(metadata)}\n`, 'utf8');
	return metadata;
}

function normalizeCommit(value, label) {
	const commit = String(value || '').trim().toLowerCase();
	if (!COMMIT_PATTERN.test(commit)) {
		throw new Error(
			`Search corpus must contain a full 40-character ${label} commit.`,
		);
	}
	return commit;
}

function isDirectExecution() {
	if (!process.argv[1]) return false;
	return (
		resolve(process.argv[1]).toLowerCase() ===
		fileURLToPath(import.meta.url).toLowerCase()
	);
}

if (isDirectExecution()) {
	const metadata = await writeBuildMetadata();
	console.log(JSON.stringify({ event: 'build_metadata_written', ...metadata }));
}
