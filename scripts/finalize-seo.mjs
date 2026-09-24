import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile('.vectorize/content-manifest.json', 'utf8'));
const fallbackPaths = new Set(
	manifest.routes.filter((route) => route.canonicalPath).map((route) => route.url),
);
const sitemapFile = 'dist/sitemap-0.xml';
const sitemap = await readFile(sitemapFile, 'utf8');
const removedPaths = new Set();
const updated = sitemap.replace(/<url>.*?<\/url>/gs, (entry) => {
	const location = entry.match(/<loc>(.*?)<\/loc>/)?.[1];
	assert.ok(location, 'Sitemap entry has no <loc>');
	const path = new URL(location).pathname;
	if (fallbackPaths.has(path)) {
		removedPaths.add(path);
		return '';
	}

	return entry.replace(/<xhtml:link\b[^>]*\/>/g, (alternate) => {
		const href = alternate.match(/\bhref="([^"]+)"/)?.[1];
		return href && fallbackPaths.has(new URL(href).pathname) ? '' : alternate;
	});
});

assert.equal(removedPaths.size, fallbackPaths.size, 'Untranslated English routes missing from sitemap');
assert.ok(![...fallbackPaths].some((path) => updated.includes(new URL(path, 'https://world-foundation.acecore.net').href)));
await writeFile(sitemapFile, updated);
console.log(`Removed ${removedPaths.size} untranslated English URLs from the sitemap`);
