import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

/**
 * traduora documentation sidebar — migrated from the Docusaurus v1 sidebars.json
 * (Quickstart / Concepts / API reference / Tools / Misc).
 */
const sidebars: SidebarsConfig = {
	docs: [
		'index',
		{
			type: 'category',
			label: 'Quickstart',
			collapsed: false,
			items: ['getting-started', 'screenshots', 'deployment', 'configuration']
		},
		{
			type: 'category',
			label: 'Concepts',
			items: ['concepts/formats']
		},
		{
			type: 'category',
			label: 'API reference',
			items: [
				'api/v1/overview',
				'api/v1/authentication',
				'api/v1/roles-permissions',
				'api/v1/endpoints',
				'api/v1/errors'
			]
		},
		{
			type: 'category',
			label: 'Tools',
			items: ['tools/cli']
		},
		{
			type: 'category',
			label: 'Misc',
			items: ['changelog', 'contributing', 'faq']
		}
	]
};

export default sidebars;
