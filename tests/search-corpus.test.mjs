import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import {
	SEARCH_VECTOR_LIMIT,
	buildSearchCorpus,
	chunkSearchDocument,
	createSearchVectorId,
} from '../scripts/build-search-corpus.mjs';
import { SEARCH_VECTOR_ID_CONTRACT } from '../scripts/search-contract.mjs';

const SITE_COMMIT = '1'.repeat(40);
const CONTENT_COMMIT = '2'.repeat(40);
const temporaryRoots = [];

after(async () => {
	await Promise.all(
		temporaryRoots.map((directory) =>
			rm(directory, { force: true, recursive: true }),
		),
	);
});

test('公開HTMLとmanifestから決定的な日英corpusを作り、除外要素を混ぜない', async () => {
	const fixture = await createFixture([
		{
			url: '/docs/vision/',
			locale: 'ja',
			html: pageHtml({
				lang: 'ja',
				title: 'ビジョン',
				body: `
					<nav>検索に含めないナビゲーション</nav>
					<blockquote>
						原文: <a href="https://github.com/acecore-systems/world-foundation/blob/main/docs/ja/00-vision.md">GitHubで原文を見る</a>
						/ <a href="https://github.com/acecore-systems/world-foundation/edit/main/docs/ja/00-vision.md">編集を提案</a>
					</blockquote>
					<p>すべての人が好きなことに集中できる世界を目指します。</p>
					<h2>自由参加</h2>
					<p>参加も離脱も自由で、地域ごとの違いを残したままつながります。</p>
					<blockquote>この引用は公開本文なので検索対象に残します。</blockquote>
					<pre><code>const secret = "検索に含めないコード";</code></pre>
					<svg><text>検索に含めない図</text></svg>
					<script>検索に含めないスクリプト</script>
					<style>.hidden { content: "検索に含めないCSS"; }</style>
				`,
			}),
		},
		{
			url: '/en/docs/vision/',
			locale: 'en',
			html: pageHtml({
				lang: 'en',
				title: 'Vision',
				body: `
					<blockquote>
						Source: <a href="https://github.com/acecore-systems/world-foundation/blob/main/docs/en/00-vision.md">View on GitHub</a>
						/ <a href="https://github.com/acecore-systems/world-foundation/edit/main/docs/en/00-vision.md">Propose an edit</a>
					</blockquote>
					<p>World Foundation keeps participation voluntary and exit possible.</p>
					<h2>Local autonomy</h2>
					<p>Regions can retain their differences while sharing an open protocol.</p>
				`,
			}),
		},
		{
			url: '/404.html',
			locale: 'ja',
			searchable: false,
		},
	]);

	const first = await buildSearchCorpus({
		...fixture,
		siteCommit: SITE_COMMIT,
		write: false,
	});
	const second = await buildSearchCorpus({
		...fixture,
		siteCommit: SITE_COMMIT,
		write: false,
	});

	assert.equal(first.schemaVersion, 1);
	assert.equal(first.siteCommit, SITE_COMMIT);
	assert.equal(first.contentCommit, CONTENT_COMMIT);
	assert.equal(first.sourceCount, 2);
	assert.equal(first.vectorCount, 2);
	assert.deepEqual(first.localeCounts, { ja: 1, en: 1 });
	assert.equal(first.version, second.version);
	assert.deepEqual(first.chunks, second.chunks);

	const japanese = first.chunks.find(({ namespace }) => namespace === 'ja');
	const english = first.chunks.find(({ namespace }) => namespace === 'en');
	assert.match(japanese.id, /^wf-v1-[0-9a-f]{48}$/);
	assert.equal(japanese.metadata.url, '/docs/vision/');
	assert.equal(japanese.metadata.title, 'ビジョン');
	assert.equal(japanese.metadata.section, '自由参加');
	assert.equal(japanese.metadata.locale, 'ja');
	assert.match(japanese.text, /地域ごとの違い/);
	assert.match(japanese.text, /この引用は公開本文/);
	assert.doesNotMatch(
		japanese.text,
		/原文|編集を提案|ナビゲーション|コード|検索に含めない図|スクリプト|CSS/,
	);
	assert.equal(english.metadata.locale, 'en');
	assert.match(english.text, /Local autonomy/);
});

test('main[data-pagefind-body]以外は本文として扱わない', async () => {
	const fixture = await createFixture([
		{
			url: '/docs/missing-main/',
			locale: 'ja',
			html: '<html lang="ja"><main><h1>対象外</h1><p>属性がない本文</p></main></html>',
		},
	]);

	await assert.rejects(
		buildSearchCorpus({
			...fixture,
			siteCommit: SITE_COMMIT,
			write: false,
		}),
		/main\[data-pagefind-body\]/,
	);
});

test('長い本文を1200文字以内かつ120文字overlapで分割する', () => {
	const document = {
		url: '/docs/long/',
		locale: 'ja',
		title: '長い文書',
		blocks: [
			{
				heading: '長い節',
				text: Array.from(
					{ length: 36 },
					(_, index) => `文${index.toString().padStart(2, '0')}${'あ'.repeat(45)}。`,
				).join(''),
			},
		],
	};

	const chunks = chunkSearchDocument(document);
	assert.ok(chunks.length >= 2);
	assert.ok(chunks.every(({ text }) => text.length <= 1200));
	assert.ok(chunks.every(({ id }) => /^wf-v1-[0-9a-f]{48}$/.test(id)));

	const firstBodyTail = chunks[0].text.slice(-120);
	assert.ok(chunks[1].text.includes(firstBodyTail));
});

test('vector IDをschema・embedding・chunking契約の全項目に結び付ける', () => {
	const identity = {
		locale: 'ja',
		url: '/docs/vector-contract/',
		index: 0,
		text: 'World Foundation vector identity contract',
	};
	const baseline = createSearchVectorId(identity);
	assert.match(baseline, /^wf-v1-[0-9a-f]{48}$/);
	assert.equal(
		createSearchVectorId(identity, { ...SEARCH_VECTOR_ID_CONTRACT }),
		baseline,
	);

	const changes = {
		schemaVersion: SEARCH_VECTOR_ID_CONTRACT.schemaVersion + 1,
		embeddingModel: `${SEARCH_VECTOR_ID_CONTRACT.embeddingModel}-revision`,
		embeddingDimensions:
			SEARCH_VECTOR_ID_CONTRACT.embeddingDimensions === 1024 ? 768 : 1024,
		distanceMetric:
			SEARCH_VECTOR_ID_CONTRACT.distanceMetric === 'cosine'
				? 'dot-product'
				: 'cosine',
		chunkTargetCharacters:
			SEARCH_VECTOR_ID_CONTRACT.chunkTargetCharacters + 1,
		chunkMaximumCharacters:
			SEARCH_VECTOR_ID_CONTRACT.chunkMaximumCharacters + 1,
		chunkOverlapCharacters:
			SEARCH_VECTOR_ID_CONTRACT.chunkOverlapCharacters + 1,
	};

	for (const [field, value] of Object.entries(changes)) {
		const changed = createSearchVectorId(identity, {
			...SEARCH_VECTOR_ID_CONTRACT,
			[field]: value,
		});
		assert.notEqual(changed, baseline, `${field} must change the vector ID`);
	}
});

test('1000件を超えるvectorをcorpus生成時に拒否する', async () => {
	const paragraphs = Array.from(
		{ length: SEARCH_VECTOR_LIMIT + 1 },
		(_, index) =>
			`<p>段落${index.toString().padStart(4, '0')}:${'あ'.repeat(820)}</p>`,
	).join('');
	const fixture = await createFixture([
		{
			url: '/docs/too-large/',
			locale: 'ja',
			html: pageHtml({
				lang: 'ja',
				title: '大きすぎる文書',
				body: paragraphs,
			}),
		},
	]);

	await assert.rejects(
		buildSearchCorpus({
			...fixture,
			siteCommit: SITE_COMMIT,
			write: false,
		}),
		/configured limit is 1000/,
	);
});

async function createFixture(routes) {
	const root = await mkdtemp(join(tmpdir(), 'world-foundation-corpus-'));
	temporaryRoots.push(root);
	const distDir = join(root, 'dist');
	const manifestFile = join(root, 'content-manifest.json');
	await mkdir(distDir, { recursive: true });

	for (const route of routes) {
		if (route.html === undefined) continue;
		const htmlFile = routeToFile(distDir, route.url);
		await mkdir(join(htmlFile, '..'), { recursive: true });
		await writeFile(htmlFile, route.html, 'utf8');
	}

	await writeFile(
		manifestFile,
		JSON.stringify({
			schemaVersion: 1,
			contentCommit: CONTENT_COMMIT,
			routes: routes.map(({ url, locale, searchable = true }) => ({
				url,
				locale,
				searchable,
			})),
		}),
		'utf8',
	);
	return { distDir, manifestFile };
}

function routeToFile(distDir, url) {
	if (url === '/') return join(distDir, 'index.html');
	if (url.endsWith('.html')) return join(distDir, url.slice(1));
	return join(distDir, url.slice(1), 'index.html');
}

function pageHtml({ lang, title, body }) {
	return `<!doctype html>
		<html lang="${lang}">
			<head>
				<title>${title}</title>
				<meta property="og:title" content="${title}">
			</head>
			<body>
				<header>検索に含めないheader</header>
				<main data-pagefind-body>
					<h1>${title}</h1>
					${body}
				</main>
				<footer>検索に含めないfooter</footer>
			</body>
		</html>`;
}
