import React, { useState, useEffect } from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import { useColorMode } from '@docusaurus/theme-common';
import SearchBar from '@theme/SearchBar';
import LocaleDropdown from './LocaleDropdown';

interface NavItem {
	to?: string;
	href?: string;
	label: string;
	position?: 'left' | 'right';
	className?: string;
}

const MenuIcon = () => (
	<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
		<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
	</svg>
);

const CloseIcon = () => (
	<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
		<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
	</svg>
);

const MobileMenu: React.FC = () => {
	const { siteConfig } = useDocusaurusContext();
	const { colorMode, setColorMode } = useColorMode();
	const navbarItems = (siteConfig.themeConfig?.navbar as any)?.items || [];
	const [isOpen, setIsOpen] = useState(false);

	const toggleMenu = () => setIsOpen(!isOpen);
	const closeMenu = () => setIsOpen(false);

	// Prevent body scroll when menu is open
	useEffect(() => {
		if (isOpen) {
			document.body.style.overflow = 'hidden';
		} else {
			document.body.style.overflow = '';
		}
		return () => {
			document.body.style.overflow = '';
		};
	}, [isOpen]);

	// Close menu on escape key
	useEffect(() => {
		const handleEscape = (e: KeyboardEvent) => {
			if (e.key === 'Escape') closeMenu();
		};
		document.addEventListener('keydown', handleEscape);
		return () => document.removeEventListener('keydown', handleEscape);
	}, []);

	return (
		<div className="lg:hidden">
			<button
				onClick={toggleMenu}
				className="relative z-[1000] p-2 text-[#808098] hover:text-white transition-colors"
				aria-label={isOpen ? 'Close menu' : 'Open menu'}
			>
				{isOpen ? <CloseIcon /> : <MenuIcon />}
			</button>

			{/* Mobile menu overlay */}
			{isOpen && (
				<>
					{/* Backdrop */}
					<div
						className="fixed inset-0 top-[3.5rem] z-[999] bg-black/95 backdrop-blur-xl"
						onClick={closeMenu}
					/>

					{/* Menu content */}
					<div className="fixed inset-x-0 top-[3.5rem] z-[1000] p-6 pb-20 min-h-[calc(100vh-3.5rem)] bg-black/95 backdrop-blur-xl overflow-y-auto">
						{/* Mobile Search */}
						<div className="flex gap-2 justify-center items-center mb-4">
							<SearchBar />
							<LocaleDropdown />
						</div>

						<nav className="flex flex-col gap-1">
							{navbarItems.map((item: NavItem, index: number) => {
								const href = item.to || item.href || '/';
								const isExternal = item.href?.startsWith('http');

								return (
									<a
										key={index}
										href={href}
										target={isExternal ? '_blank' : undefined}
										rel={isExternal ? 'noopener noreferrer' : undefined}
										onClick={closeMenu}
										className={`flex items-center justify-between p-4 rounded-lg text-[#a0a0b8] hover:text-white hover:bg-[#1a1a2e] transition-colors duration-200 ${item.className || ''}`}
									>
										<span className="text-base font-medium">{item.label}</span>
										{isExternal && (
											<svg
												className="w-4 h-4 opacity-50"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													strokeLinecap="round"
													strokeLinejoin="round"
													strokeWidth={2}
													d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
												/>
											</svg>
										)}
									</a>
								);
							})}
						</nav>

						{/* Color Mode Toggle */}
						<div className="mt-4 flex items-center justify-between p-4 rounded-lg text-[#a0a0b8]">
							<span className="text-base font-medium">
								{colorMode === 'dark' ? 'Dark Mode' : 'Light Mode'}
							</span>
							<button
								onClick={() => setColorMode(colorMode === 'dark' ? 'light' : 'dark')}
								className="text-[#808098] hover:text-white"
							>
								Toggle
							</button>
						</div>

						{/* Get Started Button */}
						<div className="mt-6 sm:hidden">
							<a
								href="/"
								className="block w-full py-3 px-6 text-center text-white rounded-full font-medium transition-opacity hover:opacity-90"
								style={{
									background:
										'linear-gradient(#0a0a14, #0a0a14) padding-box, linear-gradient(135deg, #f43f5e, #a855f7, #6366f1) border-box',
									border: '1px solid transparent'
								}}
								onClick={closeMenu}
							>
								Get Started
							</a>
						</div>
					</div>
				</>
			)}
		</div>
	);
};

export default MobileMenu;
