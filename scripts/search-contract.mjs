import { createHash } from 'node:crypto';

export const SEARCH_CORPUS_SCHEMA_VERSION = 1;
export const SEARCH_EMBEDDING_MODEL = '@cf/baai/bge-m3';
export const SEARCH_EMBEDDING_DIMENSIONS = 1024;
export const SEARCH_DISTANCE_METRIC = 'cosine';
export const SEARCH_VECTOR_LIMIT = 1000;

export const SEARCH_CHUNK_TARGET_CHARACTERS = 850;
export const SEARCH_CHUNK_MAXIMUM_CHARACTERS = 1200;
export const SEARCH_CHUNK_OVERLAP_CHARACTERS = 120;

export const SEARCH_VECTOR_ID_HASH_CHARACTERS = 48;
export const SEARCH_VECTOR_ID_PREFIX = `wf-v${SEARCH_CORPUS_SCHEMA_VERSION}-`;
export const SEARCH_CORPUS_VERSION_HASH_CHARACTERS = 20;

export const SEARCH_VECTOR_ID_CONTRACT = Object.freeze({
	schemaVersion: SEARCH_CORPUS_SCHEMA_VERSION,
	embeddingModel: SEARCH_EMBEDDING_MODEL,
	embeddingDimensions: SEARCH_EMBEDDING_DIMENSIONS,
	distanceMetric: SEARCH_DISTANCE_METRIC,
	chunkTargetCharacters: SEARCH_CHUNK_TARGET_CHARACTERS,
	chunkMaximumCharacters: SEARCH_CHUNK_MAXIMUM_CHARACTERS,
	chunkOverlapCharacters: SEARCH_CHUNK_OVERLAP_CHARACTERS,
});

export function serializeSearchVectorIdContract(
	contract = SEARCH_VECTOR_ID_CONTRACT,
) {
	return [
		`schemaVersion=${contract.schemaVersion}`,
		`embeddingModel=${contract.embeddingModel}`,
		`embeddingDimensions=${contract.embeddingDimensions}`,
		`distanceMetric=${contract.distanceMetric}`,
		`chunkTargetCharacters=${contract.chunkTargetCharacters}`,
		`chunkMaximumCharacters=${contract.chunkMaximumCharacters}`,
		`chunkOverlapCharacters=${contract.chunkOverlapCharacters}`,
	].join('\n');
}

export function createSearchVectorId(
	{ locale, url, index, text },
	contract = SEARCH_VECTOR_ID_CONTRACT,
) {
	const prefix = `wf-v${contract.schemaVersion}-`;
	return `${prefix}${createHash('sha256')
		.update(
			[
				serializeSearchVectorIdContract(contract),
				`locale=${locale}`,
				`url=${url}`,
				`chunkIndex=${index}`,
				'text:',
				text,
			].join('\n'),
		)
		.digest('hex')
		.slice(0, SEARCH_VECTOR_ID_HASH_CHARACTERS)}`;
}

export function createSearchCorpusVersion({
	siteCommit,
	contentCommit,
	vectorIds,
}) {
	return createHash('sha256')
		.update(
			[
				String(siteCommit).toLowerCase(),
				String(contentCommit).toLowerCase(),
				...[...vectorIds].sort(),
			].join('\n'),
		)
		.digest('hex')
		.slice(0, SEARCH_CORPUS_VERSION_HASH_CHARACTERS);
}
