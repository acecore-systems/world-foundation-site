// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';

export default defineConfig({
	site: 'https://acecore-systems.github.io',
	base: '/world-foundation-site',
	integrations: [
		mermaid(),
		starlight({
			title: 'World Foundation Design',
			disable404Route: true,
			locales: {
				root: {
					label: '日本語',
					lang: 'ja',
				},
				en: {
					label: 'English',
					lang: 'en',
				},
			},
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/acecore-systems/world-foundation',
				},
			],
			sidebar: [
				{
					label: '基本設計',
					items: [{ autogenerate: { directory: 'docs' } }],
				},
				{
					label: 'モジュール',
					items: [{ autogenerate: { directory: 'modules' } }],
				},
				{
					label: '運用',
					items: [{ slug: 'proposals' }, { slug: 'decisions' }, { slug: 'glossary' }],
				},
				{
					label: '調査・図表',
					items: [{ slug: 'research' }, { slug: 'research/topics' }, { slug: 'diagrams' }],
				},
				{
					label: '方針',
					items: [
						{ slug: 'policies/safety' },
						{ slug: 'policies/code-of-conduct' },
						{ slug: 'policies/governance' },
						{ slug: 'policies/contributing' },
					],
				},
			],
		}),
	],
});
