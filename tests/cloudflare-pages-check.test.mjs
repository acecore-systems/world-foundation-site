import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveCloudflarePagesCheck } from '../scripts/resolve-cloudflare-pages-check.mjs';

const DEPLOYMENT_ID = '0e3fb01a-e29c-4bdf-9b95-0e547d53487a';
const SITE_COMMIT = 'a'.repeat(40);

test('Cloudflare Pages checkからimmutable deployment markerを解決する', () => {
	const checkRun = validCheckRun();

	assert.deepEqual(resolveCloudflarePagesCheck(checkRun), {
		siteCommit: SITE_COMMIT,
		deploymentMarkerUrl:
			'https://0e3fb01a.world-foundation-site.pages.dev/.well-known/world-foundation-build.json',
	});
});

test('Pages app・main・deployment IDに一致しないcheckを拒否する', () => {
	assert.throws(
		() =>
			resolveCloudflarePagesCheck({
				...validCheckRun(),
				app: {
					id: 1,
					slug: 'untrusted-app',
				},
			}),
		/not a successful Production Pages check/,
	);
	assert.throws(
		() =>
			resolveCloudflarePagesCheck({
				...validCheckRun(),
				output: {
					summary:
						'https://ffffffff.world-foundation-site.pages.dev',
				},
			}),
		/does not match its deployment ID/,
	);
	assert.throws(
		() =>
			resolveCloudflarePagesCheck({
				...validCheckRun(),
				output: {
					summary: [
						'https://0e3fb01a.world-foundation-site.pages.dev',
						'https://ffffffff.world-foundation-site.pages.dev',
					].join('\n'),
				},
			}),
		/exactly one deployment origin/,
	);
	assert.throws(
		() =>
			resolveCloudflarePagesCheck({
				...validCheckRun(),
				details_url:
					`https://dash.cloudflare.com/?to=/${'f'.repeat(32)}/pages/view/world-foundation-site/${DEPLOYMENT_ID}`,
			}),
		/details URL is invalid/,
	);
});

function validCheckRun() {
	return {
		app: {
			id: 85455,
			slug: 'cloudflare-workers-and-pages',
		},
		name: 'Cloudflare Pages',
		status: 'completed',
		conclusion: 'success',
		head_sha: SITE_COMMIT,
		external_id: DEPLOYMENT_ID,
		details_url:
			`https://dash.cloudflare.com/?to=/db9b62f409f463da7acbcc374b8385d0/pages/view/world-foundation-site/${DEPLOYMENT_ID}`,
		check_suite: {
			head_branch: null,
		},
		output: {
			summary: [
				'[Visit deployment](https://0e3fb01a.world-foundation-site.pages.dev)',
				'https://0e3fb01a.world-foundation-site.pages.dev',
			].join('\n'),
		},
	};
}
