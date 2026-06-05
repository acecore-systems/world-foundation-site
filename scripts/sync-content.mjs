import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const siteRoot = process.cwd();
const defaultSourceRoot = await findDefaultSourceRoot();
const sourceRoot = path.resolve(
	process.env.WORLD_FOUNDATION_SOURCE || defaultSourceRoot,
);
const outputRoot = path.join(siteRoot, 'src', 'content', 'docs');
const publicAssetRoot = path.join(siteRoot, 'public', 'source-assets');
const sourceRepoUrl = 'https://github.com/acecore-systems/world-foundation';
const siteBasePath = normalizeBasePath(process.env.SITE_BASE_PATH || '');
const staticAssetSources = new Set();

const pages = [
	{ src: 'README.md', dest: 'index.md', title: 'World Foundation設計', lang: 'ja' },
	{ src: 'CONTRIBUTING.md', dest: 'policies/contributing.md', title: '貢献ガイド', lang: 'ja' },
	{ src: 'GOVERNANCE.md', dest: 'policies/governance.md', title: '運営方針', lang: 'ja' },
	{ src: 'SAFETY.md', dest: 'policies/safety.md', title: '安全方針', lang: 'ja' },
	{ src: 'CODE_OF_CONDUCT.md', dest: 'policies/code-of-conduct.md', title: '行動規範', lang: 'ja' },
	{ src: 'docs/ja/README.md', dest: 'docs/index.md', title: '設計文書', lang: 'ja' },
	{ src: 'docs/ja/00-vision.md', dest: 'docs/00-vision.md', title: 'ビジョン', lang: 'ja' },
	{ src: 'docs/ja/01-principles.md', dest: 'docs/01-principles.md', title: '設計原則', lang: 'ja' },
	{ src: 'docs/ja/02-architecture.md', dest: 'docs/02-architecture.md', title: 'アーキテクチャ', lang: 'ja' },
	{ src: 'docs/ja/03-roadmap.md', dest: 'docs/03-roadmap.md', title: 'ロードマップ', lang: 'ja' },
	{ src: 'docs/ja/04-non-goals.md', dest: 'docs/04-non-goals.md', title: '対象外', lang: 'ja' },
	{ src: 'docs/ja/05-threat-model.md', dest: 'docs/05-threat-model.md', title: '脅威モデル', lang: 'ja' },
	{
		src: 'docs/ja/06-life-access-sustainability.md',
		dest: 'docs/06-life-access-sustainability.md',
		title: '生活アクセスの持続可能性',
		lang: 'ja',
	},
	{
		src: 'docs/ja/07-translation-status.md',
		dest: 'docs/07-translation-status.md',
		title: '翻訳ステータス',
		lang: 'ja',
	},
	{ src: 'modules/ja/README.md', dest: 'modules/index.md', title: 'モジュール', lang: 'ja' },
	{ src: 'modules/ja/identity/README.md', dest: 'modules/identity.md', title: 'アイデンティティモジュール', lang: 'ja' },
	{
		src: 'modules/ja/reputation/README.md',
		dest: 'modules/reputation.md',
		title: '評判モジュール',
		lang: 'ja',
	},
	{ src: 'modules/ja/economy/README.md', dest: 'modules/economy.md', title: '経済モジュール', lang: 'ja' },
	{ src: 'modules/ja/welfare/README.md', dest: 'modules/welfare.md', title: '福祉モジュール', lang: 'ja' },
	{
		src: 'modules/ja/governance/README.md',
		dest: 'modules/governance.md',
		title: 'ガバナンスモジュール',
		lang: 'ja',
	},
	{
		src: 'modules/ja/arbitration/README.md',
		dest: 'modules/arbitration.md',
		title: '仲裁モジュール',
		lang: 'ja',
	},
	{
		src: 'modules/ja/infrastructure/README.md',
		dest: 'modules/infrastructure.md',
		title: '基盤モジュール',
		lang: 'ja',
	},
	{ src: 'modules/ja/audit/README.md', dest: 'modules/audit.md', title: '監査モジュール', lang: 'ja' },
	{ src: 'modules/ja/norms/README.md', dest: 'modules/norms.md', title: '規範モジュール', lang: 'ja' },
	{
		src: 'modules/ja/public-safety/README.md',
		dest: 'modules/public-safety.md',
		title: '公共安全モジュール',
		lang: 'ja',
	},
	{
		src: 'modules/ja/federation/README.md',
		dest: 'modules/federation.md',
		title: '連合モジュール',
		lang: 'ja',
	},
	{ src: 'proposals/ja/README.md', dest: 'proposals/index.md', title: '提案', lang: 'ja' },
	{
		src: 'proposals/ja/0001-initial-governance-process.md',
		dest: 'proposals/0001-initial-governance-process.md',
		title: '初期ガバナンスプロセス',
		lang: 'ja',
	},
	{ src: 'decisions/ja/README.md', dest: 'decisions/index.md', title: '意思決定', lang: 'ja' },
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
		title: '創設者非特権と退出方針',
		lang: 'ja',
	},
	{ src: 'research/ja/README.md', dest: 'research/index.md', title: '調査', lang: 'ja' },
	{ src: 'research/ja/index.md', dest: 'research/topics.md', title: '調査索引', lang: 'ja' },
	{ src: 'glossary/README.md', dest: 'glossary/index.md', title: '用語集', lang: 'ja' },
	{ src: 'assets/diagrams/README.md', dest: 'diagrams/index.md', title: '図表', lang: 'ja' },
	{
		src: 'assets/diagrams/00-world-design-overview.md',
		dest: 'diagrams/00-world-design-overview.md',
		title: '全体構造',
		lang: 'ja',
	},
	{
		src: 'assets/diagrams/01-cooperation-foundation-layers.md',
		dest: 'diagrams/01-cooperation-foundation-layers.md',
		title: '協力基盤の階層',
		lang: 'ja',
	},
	{
		src: 'assets/diagrams/02-module-relationships.md',
		dest: 'diagrams/02-module-relationships.md',
		title: 'モジュール関係',
		lang: 'ja',
	},
	{
		src: 'assets/diagrams/03-governance-process.md',
		dest: 'diagrams/03-governance-process.md',
		title: 'ガバナンスプロセス',
		lang: 'ja',
	},
	{
		src: 'assets/diagrams/04-transition-roadmap.md',
		dest: 'diagrams/04-transition-roadmap.md',
		title: '移行ロードマップ',
		lang: 'ja',
	},
	{
		src: 'assets/diagrams/05-risk-and-safety-loops.md',
		dest: 'diagrams/05-risk-and-safety-loops.md',
		title: 'リスクと安全性のループ',
		lang: 'ja',
	},
	{
		src: 'assets/diagrams/06-multilingual-document-flow.md',
		dest: 'diagrams/06-multilingual-document-flow.md',
		title: '多言語ドキュメント運用',
		lang: 'ja',
	},
	{
		src: 'assets/diagrams/07-life-access-model.md',
		dest: 'diagrams/07-life-access-model.md',
		title: '生活アクセスモデル',
		lang: 'ja',
	},
	{
		src: 'assets/diagrams/08-non-coercive-adoption.md',
		dest: 'diagrams/08-non-coercive-adoption.md',
		title: '非強制的な導入',
		lang: 'ja',
	},
	{
		src: 'assets/diagrams/09-expanded-module-map.md',
		dest: 'diagrams/09-expanded-module-map.md',
		title: '拡張モジュール関係',
		lang: 'ja',
	},
	{ src: 'docs/en/README.md', dest: 'en/index.md', title: 'World Foundation Design Documents', lang: 'en' },
	{ src: 'docs/en/README.md', dest: 'en/docs/index.md', title: 'World Foundation Design Documents', lang: 'en' },
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
	{
		src: 'proposals/ja/0001-initial-governance-process.md',
		dest: 'en/proposals/0001-initial-governance-process.md',
		title: 'Initial Governance Process',
		lang: 'en',
	},
	{ src: 'decisions/en/README.md', dest: 'en/decisions/index.md', title: 'Decisions', lang: 'en' },
	{
		src: 'decisions/ja/0001-japanese-first-policy.md',
		dest: 'en/decisions/0001-japanese-first-policy.md',
		title: 'Japanese-first Policy',
		lang: 'en',
	},
	{
		src: 'decisions/ja/0002-single-glossary-yaml.md',
		dest: 'en/decisions/0002-single-glossary-yaml.md',
		title: 'Single Glossary YAML',
		lang: 'en',
	},
	{
		src: 'decisions/ja/0003-lightweight-governance-process.md',
		dest: 'en/decisions/0003-lightweight-governance-process.md',
		title: 'Lightweight Governance Process',
		lang: 'en',
	},
	{
		src: 'decisions/ja/0004-founder-non-privilege-and-exit-policy.md',
		dest: 'en/decisions/0004-founder-non-privilege-and-exit-policy.md',
		title: 'Founder Non-privilege and Exit Policy',
		lang: 'en',
	},
	{ src: 'research/en/README.md', dest: 'en/research/index.md', title: 'Research', lang: 'en' },
	{ src: 'research/en/index.md', dest: 'en/research/topics.md', title: 'Research Index', lang: 'en' },
	{ src: 'CONTRIBUTING.md', dest: 'en/policies/contributing.md', title: 'Contributing', lang: 'en' },
	{ src: 'GOVERNANCE.md', dest: 'en/policies/governance.md', title: 'Governance', lang: 'en' },
	{ src: 'SAFETY.md', dest: 'en/policies/safety.md', title: 'Safety', lang: 'en' },
	{ src: 'CODE_OF_CONDUCT.md', dest: 'en/policies/code-of-conduct.md', title: 'Code of Conduct', lang: 'en' },
	{ src: 'glossary/README.md', dest: 'en/glossary/index.md', title: 'Glossary', lang: 'en' },
	{ src: 'assets/diagrams/README.md', dest: 'en/diagrams/index.md', title: 'Diagrams', lang: 'en' },
	{
		src: 'assets/diagrams/00-world-design-overview.md',
		dest: 'en/diagrams/00-world-design-overview.md',
		title: 'World Design Overview',
		lang: 'en',
	},
	{
		src: 'assets/diagrams/01-cooperation-foundation-layers.md',
		dest: 'en/diagrams/01-cooperation-foundation-layers.md',
		title: 'Cooperation Foundation Layers',
		lang: 'en',
	},
	{
		src: 'assets/diagrams/02-module-relationships.md',
		dest: 'en/diagrams/02-module-relationships.md',
		title: 'Module Relationships',
		lang: 'en',
	},
	{
		src: 'assets/diagrams/03-governance-process.md',
		dest: 'en/diagrams/03-governance-process.md',
		title: 'Governance Process',
		lang: 'en',
	},
	{
		src: 'assets/diagrams/04-transition-roadmap.md',
		dest: 'en/diagrams/04-transition-roadmap.md',
		title: 'Transition Roadmap',
		lang: 'en',
	},
	{
		src: 'assets/diagrams/05-risk-and-safety-loops.md',
		dest: 'en/diagrams/05-risk-and-safety-loops.md',
		title: 'Risk and Safety Loops',
		lang: 'en',
	},
	{
		src: 'assets/diagrams/06-multilingual-document-flow.md',
		dest: 'en/diagrams/06-multilingual-document-flow.md',
		title: 'Multilingual Document Flow',
		lang: 'en',
	},
	{
		src: 'assets/diagrams/07-life-access-model.md',
		dest: 'en/diagrams/07-life-access-model.md',
		title: 'Life Access Model',
		lang: 'en',
	},
	{
		src: 'assets/diagrams/08-non-coercive-adoption.md',
		dest: 'en/diagrams/08-non-coercive-adoption.md',
		title: 'Non-coercive Adoption',
		lang: 'en',
	},
	{
		src: 'assets/diagrams/09-expanded-module-map.md',
		dest: 'en/diagrams/09-expanded-module-map.md',
		title: 'Expanded Module Relationships',
		lang: 'en',
	},
];

const sourceToDest = new Map();
const sourceToDestByLang = new Map();

for (const page of pages) {
	const source = normalize(page.src);
	if (!sourceToDest.has(source)) sourceToDest.set(source, page.dest);
	sourceToDestByLang.set(`${page.lang}:${source}`, page.dest);
}

await rm(outputRoot, { recursive: true, force: true });
await rm(publicAssetRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

for (const page of pages) {
	const sourcePath = path.join(sourceRoot, page.src);
	const outputPath = path.join(outputRoot, page.dest);
	const markdown = await readFile(sourcePath, 'utf8');
	const body = rewriteLinks(stripLeadingHeading(markdown), page);
	const generated = renderPage(page, body);
	await mkdir(path.dirname(outputPath), { recursive: true });
	await writeFile(outputPath, generated);
}

for (const assetSource of staticAssetSources) {
	const sourcePath = path.join(sourceRoot, assetSource);
	const outputPath = path.join(publicAssetRoot, assetSource);
	await mkdir(path.dirname(outputPath), { recursive: true });
	if (/\.svg$/i.test(assetSource)) {
		const svg = await readFile(sourcePath, 'utf8');
		await writeFile(outputPath, rewriteSvgLinks(svg, assetSource));
	} else {
		await copyFile(sourcePath, outputPath);
	}
}

console.log(`Synced ${pages.length} pages from ${sourceRoot}`);
if (staticAssetSources.size > 0) {
	console.log(`Copied ${staticAssetSources.size} static asset(s)`);
}

function renderPage(page, body) {
	const sourceUrl = `${sourceRepoUrl}/blob/main/${encodeURI(page.src).replaceAll('%2F', '/')}`;
	const editUrl = `${sourceRepoUrl}/edit/main/${encodeURI(page.src).replaceAll('%2F', '/')}`;
	const sourceLabel = page.lang === 'en' ? 'Source document' : '正本文書';
	const editLabel = page.lang === 'en' ? 'Propose an edit' : '編集を提案';
	const note = `> ${sourceLabel}: [${page.src}](${sourceUrl}) / [${editLabel}](${editUrl})`;
	const description =
		page.lang === 'en' ? `Generated from ${page.src}` : `${page.src} から生成`;

	return `---\ntitle: ${JSON.stringify(page.title)}\ndescription: ${JSON.stringify(description)}\n---\n\n${note}\n\n${body.trim()}\n`;
}

function rewriteLinks(markdown, page) {
	return markdown
		.replace(/!\[([^\]]*)\]\((?!https?:|mailto:|#|\/)([^)]+)\)/g, (match, label, target) => {
			const rewritten = resolveSourceTarget(target, page);
			if (!rewritten) return match;
			return `![${label}](${rewritten})`;
		})
		.replace(/(\[!\[[^\]]*\]\([^)]+\)\]\()((?!https?:|mailto:|#|\/)[^)]+)(\))/g, (match, prefix, target, suffix) => {
			const rewritten = resolveSourceTarget(target, page);
			if (!rewritten) return match;
			return `${prefix}${rewritten}${suffix}`;
		})
		.replace(/\[([^\]]+)\]\((?!https?:|mailto:|#|\/)([^)]+)\)/g, (match, label, target) => {
			const rewritten = resolveSourceTarget(target, page);
			if (!rewritten) return match;
			return `[${label}](${rewritten})`;
		})
		.replace(/(click\s+\S+\s+")([^"]+)(")/g, (match, prefix, target, suffix) => {
			if (/^(https?:|mailto:|#|\/)/.test(target)) return match;
			const rewritten = resolveSourceTarget(target, page);
			if (!rewritten) return match;
			return `${prefix}${rewritten}${suffix}`;
		});
}

function resolveSourceTarget(target, page) {
	return resolveRepositoryTarget(target, path.dirname(page.src), page.lang);
}

function resolveAssetTarget(target, assetSource) {
	return resolveRepositoryTarget(
		target,
		path.dirname(assetSource),
		inferLangFromSource(assetSource),
	);
}

function resolveRepositoryTarget(target, sourceDirectory, lang) {
	const [targetPath, hash = ''] = target.split('#');
	if (!targetPath) return null;

	const absoluteSourceTarget = normalize(path.join(sourceDirectory, targetPath));
	const outputTarget = getOutputTarget(absoluteSourceTarget, lang);
	if (outputTarget) return toSiteLink(outputTarget, hash);

	if (targetPath.endsWith('/')) {
		const directoryReadme = normalize(path.join(absoluteSourceTarget, 'README.md'));
		const directoryOutput = getOutputTarget(directoryReadme, lang);
		if (directoryOutput) return toSiteLink(directoryOutput, hash);
	}

	if (isStaticAssetTarget(absoluteSourceTarget)) {
		staticAssetSources.add(absoluteSourceTarget);
		return toPublicAssetLink(absoluteSourceTarget, hash);
	}

	return `${sourceRepoUrl}/blob/main/${encodeURI(absoluteSourceTarget).replaceAll('%2F', '/')}`;
}

function rewriteSvgLinks(svg, assetSource) {
	return svg.replace(
		/(<a\b[^>]*?\s(?:href|xlink:href)=)(["'])(.*?)\2/g,
		(match, prefix, quote, target) => {
			if (/^(https?:|mailto:|#|\/)/.test(target)) return match;
			const rewritten = resolveAssetTarget(target, assetSource);
			if (!rewritten) return match;
			return `${prefix}${quote}${escapeXmlAttribute(rewritten)}${quote}`;
		},
	);
}

function inferLangFromSource(source) {
	if (source.includes('/en/')) return 'en';
	if (source.includes('/ja/')) return 'ja';
	return 'ja';
}

function getOutputTarget(source, lang) {
	return sourceToDestByLang.get(`${lang}:${source}`) || sourceToDest.get(source);
}

function escapeXmlAttribute(value) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

function stripLeadingHeading(markdown) {
	return markdown.replace(/^\s*# .*(?:\r?\n)+/, '');
}

function toSiteLink(dest, hash) {
	const withoutIndex = dest.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '/');
	const cleanPath = withoutIndex.startsWith('/') ? withoutIndex : `/${withoutIndex}`;
	const pathWithBase = `${siteBasePath}${cleanPath}`.replace(/\/{2,}/g, '/');
	return hash ? `${pathWithBase}#${hash}` : pathWithBase;
}

function toPublicAssetLink(source, hash) {
	const assetPath = `/source-assets/${source}`;
	const pathWithBase = `${siteBasePath}${assetPath}`.replace(/\/{2,}/g, '/');
	return hash ? `${pathWithBase}#${hash}` : pathWithBase;
}

function isStaticAssetTarget(source) {
	return /\.(svg|png|jpe?g|gif|webp|avif|ico|pdf)$/i.test(source);
}

function normalize(filePath) {
	return filePath.split(path.sep).join('/').replace(/^\.\//, '');
}

function normalizeBasePath(basePath) {
	if (!basePath || basePath === '/') return '';
	return `/${basePath.replace(/^\/|\/$/g, '')}`;
}

async function findDefaultSourceRoot() {
	const cloudflareContentRoot = path.join(siteRoot, 'content-source');
	if (await exists(cloudflareContentRoot)) return cloudflareContentRoot;
	return path.join(siteRoot, '..', 'world-foundation');
}

async function exists(filePath) {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}
