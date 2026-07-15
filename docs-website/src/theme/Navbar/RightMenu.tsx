import React from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import { useColorMode } from '@docusaurus/theme-common';
import SearchBar from '@theme/SearchBar';

interface NavItem {
	to?: string;
	href?: string;
	label: string;
	position?: 'left' | 'right';
	className?: string;
}

const GitHubIcon = () => (
	<svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
		<path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
	</svg>
);

const SunIcon = () => (
	<svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
		<path
			strokeLinecap="round"
			strokeLinejoin="round"
			d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"
		/>
	</svg>
);

const MoonIcon = () => (
	<svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
		<path
			strokeLinecap="round"
			strokeLinejoin="round"
			d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z"
		/>
	</svg>
);

const RightMenu: React.FC = () => {
	const { siteConfig } = useDocusaurusContext();
	const { colorMode, setColorMode } = useColorMode();
	const navbarItems = (siteConfig.themeConfig?.navbar as any)?.items || [];

	const rightItems = navbarItems.filter((item: NavItem) => item.position === 'right');

	const githubItem = rightItems.find((item: NavItem) => item.className?.includes('header-github-link'));

	const toggleColorMode = () => {
		setColorMode(colorMode === 'dark' ? 'light' : 'dark');
	};

	return (
		<div className="hidden sm:flex items-center gap-3">
			{/* Search Bar */}
			<SearchBar />

			{/* GitHub Link */}
			{githubItem && (
				<a
					href={githubItem.href}
					target="_blank"
					rel="noopener noreferrer"
					className="flex items-center justify-center w-8 h-8 text-gray-400 dark:text-[#808098] hover:text-gray-900 dark:hover:text-white transition-colors duration-200"
					aria-label="GitHub"
				>
					<GitHubIcon />
				</a>
			)}

			{/* Settings / Color Mode Toggle */}
			<button
				onClick={toggleColorMode}
				className="flex items-center justify-center w-8 h-8 text-gray-400 dark:text-[#808098] hover:text-gray-900 dark:hover:text-white transition-colors duration-200"
				aria-label={`Switch to ${colorMode === 'dark' ? 'light' : 'dark'} mode`}
			>
				{colorMode === 'dark' ? <SunIcon /> : <MoonIcon />}
			</button>

			{/* Get Started Button - gradient border outline style */}
			<a
				href="/getting-started"
				className="relative inline-flex items-center justify-center px-4 py-1.5 text-[13px] font-medium text-gray-700 dark:text-white rounded-full overflow-hidden transition-opacity duration-200 hover:opacity-90"
				style={{
					background:
						colorMode === 'dark'
							? 'linear-gradient(#0a0a14, #0a0a14) padding-box, linear-gradient(135deg, #f43f5e, #a855f7, #6366f1) border-box'
							: 'linear-gradient(white, white) padding-box, linear-gradient(135deg, #f43f5e, #a855f7, #6366f1) border-box',
					border: '1px solid transparent'
				}}
			>
				Get Started
			</a>
		</div>
	);
};

export default RightMenu;
