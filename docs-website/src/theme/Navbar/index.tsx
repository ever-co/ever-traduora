import React, { JSX, useState, useEffect } from 'react';
import Logo from './Logo';
import DesktopMenu from './DesktopMenu';
import MobileMenu from './MobileMenu';
import RightMenu from './RightMenu';

function Navbar(): JSX.Element {
	const [isScrolled, setIsScrolled] = useState(false);

	useEffect(() => {
		const handleScroll = () => {
			setIsScrolled(window.scrollY > 10);
		};

		window.addEventListener('scroll', handleScroll, { passive: true });
		return () => window.removeEventListener('scroll', handleScroll);
	}, []);

	return (
		<header
			className={`navbar sticky top-0 inset-x-0 z-[100] flex items-center min-h-[3.5rem] w-full py-2 text-sm transition-all duration-300 bg-white dark:bg-black border-b ${
				isScrolled
					? 'border-gray-200 dark:border-[#1a1a2e] backdrop-blur-xl bg-white/95 dark:bg-black/95'
					: 'border-transparent'
			}`}
		>
			<nav className="w-full mx-auto px-4 sm:px-6 max-w-[1400px] flex items-center justify-between gap-4">
				{/* Logo */}
				<div className="relative z-[100] flex items-center shrink-0">
					<Logo />
				</div>

				{/* Desktop Menu - Center */}
				<DesktopMenu />

				{/* Right Menu & Mobile Menu */}
				<div className="flex items-center gap-3">
					<RightMenu />
					<MobileMenu />
				</div>
			</nav>
		</header>
	);
}

export default React.memo(Navbar);
