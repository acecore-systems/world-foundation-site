import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const validator = fileURLToPath(
	new URL('../scripts/validate-seo.mjs', import.meta.url),
);
const origin = 'https://world-foundation.acecore.net';

function validateFixture({
	canonical = `${origin}/`,
	robots = 'index, follow',
	alternate,
	sitemapOrigin = origin,
	advertiseSitemap = true,
} = {}) {
	const directory = mkdtempSync(path.join(tmpdir(), 'world-foundation-seo-'));
	const dist = path.join(directory, 'dist');
	try {
		mkdirSync(dist);
		writeFileSync(
			path.join(dist, 'sitemap-index.xml'),
			`<sitemapindex><sitemap><loc>${sitemapOrigin}/sitemap-0.xml</loc></sitemap></sitemapindex>`,
		);
		writeFileSync(
			path.join(dist, 'sitemap-0.xml'),
			`<urlset><url><loc>${origin}/</loc></url></urlset>`,
		);
		writeFileSync(
			path.join(dist, 'index.html'),
			`<html><head><link rel="canonical" href="${canonical}"><meta name="robots" content="${robots}">${alternate ? `<link rel="alternate" hreflang="en" href="${alternate}">` : ''}</head><body>Published design documentation</body></html>`,
		);
		writeFileSync(
			path.join(dist, 'robots.txt'),
			`User-agent: *\nAllow: /\n${advertiseSitemap ? `Sitemap: ${origin}/sitemap-index.xml\n` : ''}`,
		);
		return spawnSync(process.execPath, [validator], {
			cwd: directory,
			encoding: 'utf8',
		});
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

test('canonical public page and sitemap discovery pass', () => {
	const result = validateFixture();
	assert.equal(result.status, 0, result.stderr);
});

test('pages.dev canonical regression fails the build', () => {
	const result = validateFixture({
		canonical: 'https://world-foundation-site.pages.dev/',
	});
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /Canonical does not match sitemap URL/);
});

test('pages.dev sitemap origin regression fails the build', () => {
	const result = validateFixture({
		sitemapOrigin: 'https://world-foundation-site.pages.dev',
	});
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /Unexpected sitemap origin/);
});

test('public sitemap cannot advertise a noindex page', () => {
	const result = validateFixture({ robots: 'noindex, follow' });
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /Sitemap page excludes indexing/);
});

test('language alternate cannot advertise an excluded fallback', () => {
	const result = validateFixture({ alternate: `${origin}/en/` });
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /Hreflang points outside the public sitemap/);
});

test('missing robots.txt sitemap declaration fails the build', () => {
	const result = validateFixture({ advertiseSitemap: false });
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /robots.txt does not advertise/);
});
