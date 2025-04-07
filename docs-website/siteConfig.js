const repo = 'https://github.com/ever-co/ever-traduora';

const siteConfig = {
  title: 'traduora',
  tagline: 'Ever® Traduora - Open Translation Management Platform',
  url: 'https://docs.traduora.co/',
  baseUrl: '/',
  projectName: 'traduora',
  editUrl: 'https://github.com/ever-co/ever-traduora/edit/master/docs/',
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
  copyright:
    'Copyright © 2020-present <a href="https://ever.co">Ever Co. LTD</a> and <a href="https://github.com/ever-co/ever-traduora/graphs/contributors">contributors</a>. All Rights Reserved',
  repoUrl: repo,
  scripts: ['https://buttons.github.io/buttons.js'],
  stylesheets: ['https://fonts.googleapis.com/css?family=Varela+Round:400', 'https://fonts.googleapis.com/css?family=Ubuntu:400,500,700'],
  separateCss: ['swagger-ui.css'],
  onPageNav: 'separate',
};

module.exports = siteConfig;
