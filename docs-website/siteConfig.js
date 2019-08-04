const repo = 'https://github.com/traduora/traduora';

const siteConfig = {
  title: 'traduora',
  tagline: 'Translation management platform for teams',
  url: 'https://docs.traduora.com/',
  baseUrl: '/',
  projectName: 'traduora',
  editUrl: 'https://github.com/traduora/traduora/edit/master/docs/',
  headerLinks: [
    { doc: 'getting-started', label: 'Getting started' },
    { doc: 'changelog', label: 'Changelog' },
    { href: repo, label: 'GitHub' },
    { languages: true },
  ],
  favicon: 'img/favicon.ico',
  colors: {
    primaryColor: '#3b84f8',
    secondaryColor: '#121020',
  },
  highlight: {
    theme: 'vs2015',
  },
  docsUrl: 'docs',
  noIndex: false,
  gaTrackingId: process.env.GA_TRACKING_ID,
  ogImage: 'img/traduora-preview.png',
  twitterImage: 'img/traduora-preview.png',
  cleanUrl: true,
  scrollToTop: true,
  copyright: 'Copyright © ' + new Date().getFullYear() + ' traduora',
  repoUrl: repo,
  scripts: ['https://buttons.github.io/buttons.js'],
  stylesheets: ['https://fonts.googleapis.com/css?family=Varela+Round:400', 'https://fonts.googleapis.com/css?family=Ubuntu:400,500,700'],
  separateCss: ['swagger-ui.css'],
  onPageNav: 'separate',
};

module.exports = siteConfig;
