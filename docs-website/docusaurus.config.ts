import type { Config } from '@docusaurus/types';
import { themes as prismThemes } from 'prism-react-renderer';

require('dotenv').config();

const SENTRY_DNS = process.env.NEXT_PUBLIC_SENTRY_DNS || null;
const ALGOLIA_APP_ID = process.env.ALGOLIA_APP_ID || null;
const ALGOLIA_API_KEY = process.env.ALGOLIA_API_KEY || null;
const ALGOLIA_INDEX_NAME = process.env.ALGOLIA_INDEX_NAME || null;
const HAS_ALGOLIA_CREDENTIALS = ALGOLIA_APP_ID && ALGOLIA_API_KEY && ALGOLIA_INDEX_NAME;

const GITHUB_REPO_URL = 'https://github.com/ever-co/ever-traduora';

/** @type {import('@docusaurus/types').Config} */
const config: Config = {
	themes: [
		[
			'@easyops-cn/docusaurus-search-local',
			/** @type {import("@easyops-cn/docusaurus-search-local").PluginOptions} */
			{
				hashed: true,
				language: ['en'],
				indexBlog: false,
				highlightSearchTermsOnTargetPage: true,
				explicitSearchResultPath: true,
				docsRouteBasePath: '/',
				docsDir: '../docs'
			}
		],
		'@docusaurus/theme-mermaid'
	],
	plugins: [
		[
			'@docusaurus/plugin-client-redirects',
			{
				// Preserve legacy Docusaurus-v1 URLs (docs were served under /docs/*).
				createRedirects(existingPath: string) {
					if (existingPath === '/') {
						return ['/docs'];
					}
					return [`/docs${existingPath}`];
				}
			}
		],
		SENTRY_DNS &&
			process.env.NODE_ENV === 'production' && [
				'docusaurus-plugin-sentry',
				{
					DSN: process.env.NEXT_PUBLIC_SENTRY_DNS
				}
			]
	],
	title: 'traduora',
	tagline: 'Ever® Traduora — Open-source translation management platform',
	favicon: 'img/favicon.ico',
	url: 'https://docs.traduora.co',
	baseUrl: '/',

	organizationName: 'ever-co',
	projectName: 'ever-traduora',

	onBrokenLinks: 'warn',
	markdown: {
		format: 'detect',
		mermaid: true,
		hooks: {
			onBrokenMarkdownLinks: 'warn'
		}
	},
	// Docusaurus built-in field — serves repo-root docs/assets (screenshots) and
	// the local static/ folder (favicons, static Swagger UI viewer).
	staticDirectories: ['../docs/assets', 'static'],
	i18n: {
		path: 'i18n',
		defaultLocale: 'en',
		locales: ['en']
	},
	presets: [
		[
			'classic',
			/** @type {import('@docusaurus/preset-classic').Options} */
			{
				blog: false,
				docs: {
					sidebarPath: './sidebars.ts',
					path: '../docs/',
					routeBasePath: '/',
					editUrl: 'https://github.com/ever-co/ever-traduora/tree/develop/docs/'
				},
				theme: {
					customCss: './src/css/custom.css'
				},
				gtag: process.env.GA_TRACKING_ID
					? { trackingID: process.env.GA_TRACKING_ID, anonymizeIP: true }
					: undefined
			}
		]
	],
	themeConfig:
		/** @type {import('@docusaurus/preset-classic').ThemeConfig} */
		{
			image: 'img/traduora-preview.png',

			colorMode: {
				defaultMode: 'dark'
			},
			navbar: {
				style: 'dark',
				logo: {
					alt: 'traduora Logo',
					src: 'img/logo.png'
				},
				items: [
					{
						type: 'docSidebar',
						sidebarId: 'docs',
						position: 'left',
						label: 'Docs'
					},
					{ to: '/getting-started', label: 'Getting started', position: 'left' },
					{ to: '/api/v1/overview', label: 'API', position: 'left' },
					{
						href: GITHUB_REPO_URL,
						label: 'GitHub',
						position: 'right',
						className: 'header-github-link'
					}
				]
			},
			footer: {
				style: 'dark',
				logo: {
					src: 'img/logo.png',
					height: 40
				},
				links: [
					{
						title: 'Docs',
						items: [
							{ label: 'Getting Started', to: '/getting-started' },
							{ label: 'Configuration', to: '/configuration' },
							{ label: 'API reference', to: '/api/v1/overview' },
							{ label: 'CLI', to: '/tools/cli' }
						]
					},
					{
						title: 'Community',
						items: [
							{ label: 'Docker Hub', href: 'https://hub.docker.com/r/everco/ever-traduora' },
							{ label: 'GitHub', href: GITHUB_REPO_URL },
							{ label: 'Contributing', to: '/contributing' }
						]
					},
					{
						title: 'More',
						items: [
							{ label: 'traduora.co', href: 'https://traduora.co' },
							{ label: 'Changelog', to: '/changelog' },
							{ label: 'FAQ', to: '/faq' }
						]
					}
				],
				copyright: `Copyright © 2020-${new Date().getFullYear()} <a href="https://ever.co/" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">Ever Co. LTD.</a> and contributors.`
			},
			algolia: HAS_ALGOLIA_CREDENTIALS
				? {
						appId: process.env.ALGOLIA_APP_ID,
						apiKey: process.env.ALGOLIA_API_KEY,
						indexName: process.env.ALGOLIA_INDEX_NAME,
						contextualSearch: true,
						searchPagePath: 'search',
						insights: false
					}
				: undefined,
			prism: {
				theme: prismThemes.github,
				darkTheme: prismThemes.dracula,
				additionalLanguages: ['bash', 'json', 'php', 'ini']
			}
		},
	customFields: {
		footerData: {
			description:
				'traduora is an open-source translation management platform — import and export in multiple formats, translate through the UI or the API, and automate your localization workflow.',
			socialLinks: [
				{ title: 'GitHub', href: GITHUB_REPO_URL, icon: 'github' },
				{ title: 'Twitter', href: 'https://twitter.com/everhq', icon: 'twitter' },
				{ title: 'Discord', href: 'https://discord.gg/ever', icon: 'discord' }
			],
			systemStatus: {
				status: 'normal',
				message: 'All systems operational'
			},
			products: [
				{ name: 'Ever Gauzy', href: 'https://gauzy.co', description: 'Open Business Management Platform', icon: '/img/logo.png' },
				{ name: 'Ever Teams', href: 'https://ever.team', description: 'Open Work & Project Management', icon: '/img/logo.png' },
				{ name: 'Ever Works', href: 'https://ever.works', description: 'The Workshop for AI', icon: '/img/logo.png' },
				{ name: 'traduora', href: 'https://traduora.co', description: 'Open Translation Management', icon: '/img/logo.png' }
			],
			companyInfo: {
				copyright: `Copyright © ${new Date().getFullYear()} Ever Co. LTD. All Rights Reserved.`,
				disclaimer:
					'*All product names, logos, and brands are property of their respective owners. All company, product and service names used in this website are for identification purposes only. Use of these names, logos, and brands does not imply endorsement.',
				legalLinks: [
					{ text: 'Privacy Policy', href: 'https://ever.co/privacy' },
					{ text: 'Terms of Service', href: 'https://ever.co/tos' },
					{ text: 'Cookie Policy', href: 'https://ever.co/cookies' }
				]
			}
		}
	}
};

export default config;
