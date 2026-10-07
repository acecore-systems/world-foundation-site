import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';

const siteOrigin = 'https://world-foundation.acecore.net';
const distDirectory = path.resolve('dist');
const sitemapIndexUrl = `${siteOrigin}/sitemap-index.xml`;
const index = load(
	await readFile(path.join(distDirectory, 'sitemap-index.xml'), 'utf8'),
	{
		xml: true,
	},
);
const sitemapUrls = index('sitemap > loc')
	.map((_, element) => index(element).text())
	.get();
assert.ok(sitemapUrls.length > 0, 'Sitemap index contains no sitemaps');

const urls = [];
for (const sitemapUrl of sitemapUrls) {
	const location = new URL(sitemapUrl);
	assert.equal(
		location.origin,
		siteOrigin,
		`Unexpected sitemap origin: ${sitemapUrl}`,
	);
	assert.match(
		location.pathname,
		/^\/sitemap-\d+\.xml$/,
		`Unexpected sitemap path: ${sitemapUrl}`,
	);
	const sitemap = load(
		await readFile(
			path.join(distDirectory, path.basename(location.pathname)),
			'utf8',
		),
		{
			xml: true,
		},
	);
	urls.push(
		...sitemap('url > loc')
			.map((_, element) => sitemap(element).text())
			.get(),
	);
}

assert.ok(urls.length > 0, 'Sitemap contains no public pages');
const urlSet = new Set(urls);
assert.equal(urlSet.size, urls.length, 'Sitemap contains duplicate URLs');

for (const url of urls) {
	const location = new URL(url);
	assert.equal(location.origin, siteOrigin, `Unexpected page origin: ${url}`);
	assert.ok(
		!location.search && !location.hash,
		`Sitemap contains a parameterized URL: ${url}`,
	);
	const file = path.resolve(
		distDirectory,
		`.${decodeURIComponent(location.pathname)}`,
		'index.html',
	);
	assert.ok(
		file.startsWith(`${distDirectory}${path.sep}`),
		`Page path escapes dist: ${url}`,
	);
	const page = load(await readFile(file, 'utf8'));
	const canonicals = page('link[rel="canonical"]');
	assert.equal(canonicals.length, 1, `Expected one canonical: ${url}`);
	assert.equal(
		canonicals.attr('href'),
		url,
		`Canonical does not match sitemap URL: ${url}`,
	);
	page('meta[name="robots"], meta[name="googlebot"]').each((_, element) => {
		const directives = (page(element).attr('content') || '')
			.toLowerCase()
			.split(/[\s,]+/);
		assert.ok(
			!directives.includes('noindex') && !directives.includes('none'),
			`Sitemap page excludes indexing: ${url}`,
		);
	});
	page('link[rel="alternate"][hreflang]').each((_, element) => {
		const alternate = page(element).attr('href');
		assert.ok(
			urlSet.has(alternate),
			`Hreflang points outside the public sitemap: ${url} -> ${alternate}`,
		);
	});
}

const robots = await readFile(path.join(distDirectory, 'robots.txt'), 'utf8');
assert.ok(
	robots
		.split(/\r?\n/)
		.some(
			(line) =>
				/^sitemap:/i.test(line) &&
				line.slice(line.indexOf(':') + 1).trim() === sitemapIndexUrl,
		),
	'robots.txt does not advertise the canonical sitemap index',
);
console.log(
	`Validated canonical, indexing directives, and hreflang for ${urls.length} sitemap URLs`,
);
