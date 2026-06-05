import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const siteRoot = process.cwd();
const sourceRoot = path.resolve(
	process.env.WORLD_FOUNDATION_SOURCE || path.join(siteRoot, '..', 'world-foundation'),
);
const outputRoot = path.join(siteRoot, 'src', 'content', 'docs');
const sourceRepoUrl = 'https://github.com/acecore-systems/world-foundation';
const siteBasePath = normalizeBasePath(process.env.SITE_BASE_PATH || '');

const pages = [
	{ src: 'README.md', dest: 'index.md', title: 'World Foundation Design', lang: 'ja' },
	{ src: 'CONTRIBUTING.md', dest: 'policies/contributing.md', title: 'Contributing', lang: 'ja' },
	{ src: 'GOVERNANCE.md', dest: 'policies/governance.md', title: 'Governance', lang: 'ja' },
	{ src: 'SAFETY.md', dest: 'policies/safety.md', title: 'Safety', lang: 'ja' },
	{ src: 'CODE_OF_CONDUCT.md', dest: 'policies/code-of-conduct.md', title: 'Code of Conduct', lang: 'ja' },
	{ src: 'docs/ja/README.md', dest: 'docs/index.md', title: 'World Foundation設計文書', lang: 'ja' },
	{ src: 'docs/ja/00-vision.md', dest: 'docs/00-vision.md', title: 'Vision', lang: 'ja' },
	{ src: 'docs/ja/01-principles.md', dest: 'docs/01-principles.md', title: 'Principles', lang: 'ja' },
	{ src: 'docs/ja/02-architecture.md', dest: 'docs/02-architecture.md', title: 'Architecture', lang: 'ja' },
	{ src: 'docs/ja/03-roadmap.md', dest: 'docs/03-roadmap.md', title: 'Roadmap', lang: 'ja' },
	{ src: 'docs/ja/04-non-goals.md', dest: 'docs/04-non-goals.md', title: 'Non-goals', lang: 'ja' },
	{ src: 'docs/ja/05-threat-model.md', dest: 'docs/05-threat-model.md', title: 'Threat Model', lang: 'ja' },
	{
		src: 'docs/ja/06-life-access-sustainability.md',
		dest: 'docs/06-life-access-sustainability.md',
		title: 'Life Access Sustainability',
		lang: 'ja',
	},
	{
		src: 'docs/ja/07-translation-status.md',
		dest: 'docs/07-translation-status.md',
		title: 'Translation Status',
		lang: 'ja',
	},
	{ src: 'modules/ja/README.md', dest: 'modules/index.md', title: 'Modules', lang: 'ja' },
	{ src: 'modules/ja/identity/README.md', dest: 'modules/identity.md', title: 'Identity Module', lang: 'ja' },
	{
		src: 'modules/ja/reputation/README.md',
		dest: 'modules/reputation.md',
		title: 'Reputation Module',
		lang: 'ja',
	},
	{ src: 'modules/ja/economy/README.md', dest: 'modules/economy.md', title: 'Economy Module', lang: 'ja' },
	{ src: 'modules/ja/welfare/README.md', dest: 'modules/welfare.md', title: 'Welfare Module', lang: 'ja' },
	{
		src: 'modules/ja/governance/README.md',
		dest: 'modules/governance.md',
		title: 'Governance Module',
		lang: 'ja',
	},
	{
		src: 'modules/ja/arbitration/README.md',
		dest: 'modules/arbitration.md',
		title: 'Arbitration Module',
		lang: 'ja',
	},
	{
		src: 'modules/ja/infrastructure/README.md',
		dest: 'modules/infrastructure.md',
		title: 'Infrastructure Module',
		lang: 'ja',
	},
	{ src: 'modules/ja/audit/README.md', dest: 'modules/audit.md', title: 'Audit Module', lang: 'ja' },
	{ src: 'modules/ja/norms/README.md', dest: 'modules/norms.md', title: 'Norms Module', lang: 'ja' },
	{
		src: 'modules/ja/public-safety/README.md',
		dest: 'modules/public-safety.md',
		title: 'Public Safety Module',
		lang: 'ja',
	},
	{
		src: 'modules/ja/federation/README.md',
		dest: 'modules/federation.md',
		title: 'Federation Module',
		lang: 'ja',
	},
	{ src: 'proposals/ja/README.md', dest: 'proposals/index.md', title: 'Proposals', lang: 'ja' },
	{
		src: 'proposals/ja/0001-initial-governance-process.md',
		dest: 'proposals/0001-initial-governance-process.md',
		title: 'Initial Governance Process',
		lang: 'ja',
	},
	{ src: 'decisions/ja/README.md', dest: 'decisions/index.md', title: 'Decisions', lang: 'ja' },
	{
		src: 'decisions/ja/0001-japanese-first-policy.md',
		dest: 'decisions/0001-japanese-first-policy.md',
		title: '日本語ファースト方針',
		lang: 'ja',
	},
	{
		src: 'decisions/ja/0002-single-glossary-yaml.md',
		dest: 'decisions/0002-single-glossary-yaml.md',
		title: '用語集を単一YAMLで管理する',
		lang: 'ja',
	},
	{
		src: 'decisions/ja/0003-lightweight-governance-process.md',
		dest: 'decisions/0003-lightweight-governance-process.md',
		title: '初期は軽量ガバナンスで運用する',
		lang: 'ja',
	},
	{
		src: 'decisions/ja/0004-founder-non-privilege-and-exit-policy.md',
		dest: 'decisions/0004-founder-non-privilege-and-exit-policy.md',
		title: 'Founder Non-privilege and Exit Policy',
		lang: 'ja',
	},
	{ src: 'research/ja/README.md', dest: 'research/index.md', title: 'Research', lang: 'ja' },
	{ src: 'research/ja/index.md', dest: 'research/topics.md', title: 'Research Index', lang: 'ja' },
	{ src: 'glossary/README.md', dest: 'glossary/index.md', title: 'Glossary', lang: 'ja' },
	{ src: 'assets/diagrams/README.md', dest: 'diagrams/index.md', title: 'Diagrams', lang: 'ja' },
	{
		src: 'assets/diagrams/00-world-design-overview.md',
		dest: 'diagrams/00-world-design-overview.md',
		title: 'World Design Overview',
		lang: 'ja',
	},
	{
		src: 'assets/diagrams/01-cooperation-foundation-layers.md',
		dest: 'diagrams/01-cooperation-foundation-layers.md',
		title: 'Cooperation Foundation Layers',
		lang: 'ja',
	},
	{
		src: 'assets/diagrams/02-module-relationships.md',
		dest: 'diagrams/02-module-relationships.md',
		title: 'Module Relationships',
		lang: 'ja',
	},
	{
		src: 'assets/diagrams/03-governance-process.md',
		dest: 'diagrams/03-governance-process.md',
		title: 'Governance Process',
		lang: 'ja',
	},
	{
		src: 'assets/diagrams/04-transition-roadmap.md',
		dest: 'diagrams/04-transition-roadmap.md',
		title: 'Transition Roadmap',
		lang: 'ja',
	},
	{
		src: 'assets/diagrams/05-risk-and-safety-loops.md',
		dest: 'diagrams/05-risk-and-safety-loops.md',
		title: 'Risk and Safety Loops',
		lang: 'ja',
	},
	{
		src: 'assets/diagrams/06-multilingual-document-flow.md',
		dest: 'diagrams/06-multilingual-document-flow.md',
		title: 'Multilingual Document Flow',
		lang: 'ja',
	},
	{
		src: 'assets/diagrams/07-life-access-model.md',
		dest: 'diagrams/07-life-access-model.md',
		title: 'Life Access Model',
		lang: 'ja',
	},
	{
		src: 'assets/diagrams/08-non-coercive-adoption.md',
		dest: 'diagrams/08-non-coercive-adoption.md',
		title: 'Non-coercive Adoption',
		lang: 'ja',
	},
	{
		src: 'assets/diagrams/09-expanded-module-map.md',
		dest: 'diagrams/09-expanded-module-map.md',
		title: 'Expanded Module Relationships',
		lang: 'ja',
	},
	{ src: 'docs/en/README.md', dest: 'en/index.md', title: 'World Foundation Design Documents', lang: 'en' },
	{ src: 'docs/en/00-vision.md', dest: 'en/docs/00-vision.md', title: 'Vision', lang: 'en' },
	{ src: 'docs/en/01-principles.md', dest: 'en/docs/01-principles.md', title: 'Principles', lang: 'en' },
	{ src: 'docs/en/02-architecture.md', dest: 'en/docs/02-architecture.md', title: 'Architecture', lang: 'en' },
	{ src: 'docs/en/03-roadmap.md', dest: 'en/docs/03-roadmap.md', title: 'Roadmap', lang: 'en' },
	{ src: 'docs/en/04-non-goals.md', dest: 'en/docs/04-non-goals.md', title: 'Non-goals', lang: 'en' },
	{ src: 'docs/en/05-threat-model.md', dest: 'en/docs/05-threat-model.md', title: 'Threat Model', lang: 'en' },
	{
		src: 'docs/en/06-life-access-sustainability.md',
		dest: 'en/docs/06-life-access-sustainability.md',
		title: 'Life Access Sustainability',
		lang: 'en',
	},
	{
		src: 'docs/en/07-translation-status.md',
		dest: 'en/docs/07-translation-status.md',
		title: 'Translation Status',
		lang: 'en',
	},
	{ src: 'modules/en/README.md', dest: 'en/modules/index.md', title: 'Modules', lang: 'en' },
	{ src: 'modules/en/identity/README.md', dest: 'en/modules/identity.md', title: 'Identity Module', lang: 'en' },
	{
		src: 'modules/en/reputation/README.md',
		dest: 'en/modules/reputation.md',
		title: 'Reputation Module',
		lang: 'en',
	},
	{ src: 'modules/en/economy/README.md', dest: 'en/modules/economy.md', title: 'Economy Module', lang: 'en' },
	{ src: 'modules/en/welfare/README.md', dest: 'en/modules/welfare.md', title: 'Welfare Module', lang: 'en' },
	{
		src: 'modules/en/governance/README.md',
		dest: 'en/modules/governance.md',
		title: 'Governance Module',
		lang: 'en',
	},
	{
		src: 'modules/en/arbitration/README.md',
		dest: 'en/modules/arbitration.md',
		title: 'Arbitration Module',
		lang: 'en',
	},
	{
		src: 'modules/en/infrastructure/README.md',
		dest: 'en/modules/infrastructure.md',
		title: 'Infrastructure Module',
		lang: 'en',
	},
	{ src: 'modules/en/audit/README.md', dest: 'en/modules/audit.md', title: 'Audit Module', lang: 'en' },
	{ src: 'modules/en/norms/README.md', dest: 'en/modules/norms.md', title: 'Norms Module', lang: 'en' },
	{
		src: 'modules/en/public-safety/README.md',
		dest: 'en/modules/public-safety.md',
		title: 'Public Safety Module',
		lang: 'en',
	},
	{
		src: 'modules/en/federation/README.md',
		dest: 'en/modules/federation.md',
		title: 'Federation Module',
		lang: 'en',
	},
	{ src: 'proposals/en/README.md', dest: 'en/proposals/index.md', title: 'Proposals', lang: 'en' },
	{ src: 'decisions/en/README.md', dest: 'en/decisions/index.md', title: 'Decisions', lang: 'en' },
	{ src: 'research/en/README.md', dest: 'en/research/index.md', title: 'Research', lang: 'en' },
	{ src: 'research/en/index.md', dest: 'en/research/topics.md', title: 'Research Index', lang: 'en' },
];

const sourceToDest = new Map(pages.map((page) => [normalize(page.src), page.dest]));

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

for (const page of pages) {
	const sourcePath = path.join(sourceRoot, page.src);
	const outputPath = path.join(outputRoot, page.dest);
	const markdown = await readFile(sourcePath, 'utf8');
	const body = rewriteLinks(markdown, page.src);
	const generated = renderPage(page, body);
	await mkdir(path.dirname(outputPath), { recursive: true });
	await writeFile(outputPath, generated);
}

console.log(`Synced ${pages.length} pages from ${sourceRoot}`);

function renderPage(page, body) {
	const sourceUrl = `${sourceRepoUrl}/blob/main/${encodeURI(page.src).replaceAll('%2F', '/')}`;
	const editUrl = `${sourceRepoUrl}/edit/main/${encodeURI(page.src).replaceAll('%2F', '/')}`;
	const sourceLabel = page.lang === 'en' ? 'Source document' : '正本文書';
	const editLabel = page.lang === 'en' ? 'Propose an edit' : '編集を提案';
	const note = `> ${sourceLabel}: [${page.src}](${sourceUrl}) / [${editLabel}](${editUrl})`;

	return `---\ntitle: ${JSON.stringify(page.title)}\ndescription: ${JSON.stringify(`Generated from ${page.src}`)}\n---\n\n${note}\n\n${body.trim()}\n`;
}

function rewriteLinks(markdown, currentSource) {
	return markdown.replace(/\[([^\]]+)\]\((?!https?:|mailto:|#)([^)]+)\)/g, (match, label, target) => {
		const [targetPath, hash = ''] = target.split('#');
		if (!targetPath) return match;

		const absoluteSourceTarget = normalize(path.join(path.dirname(currentSource), targetPath));
		const outputTarget = sourceToDest.get(absoluteSourceTarget);
		if (outputTarget) return `[${label}](${toSiteLink(outputTarget, hash)})`;

		if (targetPath.endsWith('/')) {
			const directoryReadme = normalize(path.join(absoluteSourceTarget, 'README.md'));
			const directoryOutput = sourceToDest.get(directoryReadme);
			if (directoryOutput) return `[${label}](${toSiteLink(directoryOutput, hash)})`;
		}

		const sourceTarget = `${sourceRepoUrl}/blob/main/${encodeURI(absoluteSourceTarget).replaceAll('%2F', '/')}`;
		return `[${label}](${sourceTarget})`;
	});
}

function toSiteLink(dest, hash) {
	const withoutIndex = dest.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '/');
	const cleanPath = withoutIndex.startsWith('/') ? withoutIndex : `/${withoutIndex}`;
	const pathWithBase = `${siteBasePath}${cleanPath}`.replace(/\/{2,}/g, '/');
	return hash ? `${pathWithBase}#${hash}` : pathWithBase;
}

function normalize(filePath) {
	return filePath.split(path.sep).join('/').replace(/^\.\//, '');
}

function normalizeBasePath(basePath) {
	if (!basePath || basePath === '/') return '';
	return `/${basePath.replace(/^\/|\/$/g, '')}`;
}
