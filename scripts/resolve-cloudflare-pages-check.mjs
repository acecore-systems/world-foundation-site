import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLOUDFLARE_PAGES_APP_ID = 85455;
const CLOUDFLARE_PAGES_APP_SLUG = 'cloudflare-workers-and-pages';
const CLOUDFLARE_ACCOUNT_ID = 'db9b62f409f463da7acbcc374b8385d0';
const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
const DEPLOYMENT_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_NAME = 'world-foundation-site';

export function resolveCloudflarePagesCheck(checkRun) {
	if (
		checkRun?.app?.id !== CLOUDFLARE_PAGES_APP_ID ||
		checkRun?.app?.slug !== CLOUDFLARE_PAGES_APP_SLUG ||
		checkRun?.name !== 'Cloudflare Pages' ||
		checkRun?.status !== 'completed' ||
		checkRun?.conclusion !== 'success'
	) {
		throw new Error('The check run is not a successful Production Pages check.');
	}

	const siteCommit = String(checkRun.head_sha || '').trim().toLowerCase();
	if (!COMMIT_PATTERN.test(siteCommit)) {
		throw new Error('The Pages check must contain a full site commit SHA.');
	}

	const deploymentId = String(checkRun.external_id || '')
		.trim()
		.toLowerCase();
	if (!DEPLOYMENT_ID_PATTERN.test(deploymentId)) {
		throw new Error('The Pages check deployment ID is invalid.');
	}

	const detailsUrl = new URL(checkRun.details_url);
	const expectedDetailsTarget =
		`/${CLOUDFLARE_ACCOUNT_ID}/pages/view/${PROJECT_NAME}/${deploymentId}`.toLowerCase();
	if (
		detailsUrl.protocol !== 'https:' ||
		detailsUrl.hostname !== 'dash.cloudflare.com' ||
		detailsUrl.port ||
		detailsUrl.username ||
		detailsUrl.password ||
		detailsUrl.hash ||
		detailsUrl.pathname !== '/' ||
		detailsUrl.searchParams.size !== 1 ||
		detailsUrl.searchParams.get('to')?.toLowerCase() !== expectedDetailsTarget
	) {
		throw new Error('The Pages check details URL is invalid.');
	}

	const deploymentOrigins = new Set(
		String(checkRun.output?.summary || '')
			.match(/https:\/\/[0-9a-f]{8}\.world-foundation-site\.pages\.dev/giu)
			?.map((value) => new URL(value).origin.toLowerCase()) || [],
	);
	if (deploymentOrigins.size !== 1) {
		throw new Error(
			'The Pages check must identify exactly one deployment origin.',
		);
	}

	const [deploymentOrigin] = deploymentOrigins;
	const deploymentUrl = new URL(deploymentOrigin);
	const deploymentPrefix = deploymentId.slice(0, 8);
	if (
		deploymentUrl.hostname !==
		`${deploymentPrefix}.${PROJECT_NAME}.pages.dev`
	) {
		throw new Error(
			'The Pages deployment origin does not match its deployment ID.',
		);
	}

	return {
		siteCommit,
		deploymentMarkerUrl: new URL(
			'/.well-known/world-foundation-build.json',
			deploymentUrl,
		).href,
	};
}

function isDirectExecution() {
	if (!process.argv[1]) return false;
	return (
		resolve(process.argv[1]).toLowerCase() ===
		fileURLToPath(import.meta.url).toLowerCase()
	);
}

if (isDirectExecution()) {
	const checkRun = JSON.parse(process.env.CHECK_RUN_JSON || 'null');
	console.log(JSON.stringify(resolveCloudflarePagesCheck(checkRun)));
}
