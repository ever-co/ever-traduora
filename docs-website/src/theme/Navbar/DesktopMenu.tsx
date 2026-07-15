import React, { useState } from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Link from '@docusaurus/Link';

interface NavItem {
	to?: string;
	href?: string;
	label: string;
	position?: 'left' | 'right';
	className?: string;
}

interface CursorPosition {
	left: number;
	width: number;
	opacity: number;
}

const DesktopMenu: React.FC = () => {
	const { siteConfig } = useDocusaurusContext();
	const navbarItems = (siteConfig.themeConfig?.navbar as any)?.items || [];
	const [cursorPosition, setCursorPosition] = useState<CursorPosition>({
		left: 0,
		width: 0,
		opacity: 0
	});

	const leftItems = navbarItems.filter((item: NavItem) => item.position !== 'right');

	const handleMouseEnter = (e: React.MouseEvent<HTMLAnchorElement>) => {
		const target = e.currentTarget;
		const rect = target.getBoundingClientRect();
		const parent = target.parentElement?.getBoundingClientRect();
		if (parent) {
			setCursorPosition({
				left: rect.left - parent.left,
				width: rect.width,
				opacity: 1
			});
		}
	};

	const handleMouseLeave = () => {
		setCursorPosition((prev) => ({ ...prev, opacity: 0 }));
	};

	return (
		<div
			className="hidden lg:flex items-center relative z-50 mx-auto rounded-full border border-gray-200 dark:border-[#2a2a3d] px-1 py-0.5 bg-gray-50 dark:bg-transparent"
			onMouseLeave={handleMouseLeave}
		>
			{leftItems.map((item: NavItem, index: number) => {
				const href = item.to || item.href || '/';
				const isExternal = item.href?.startsWith('http');

				return (
					<Link
						key={index}
						href={href}
						target={isExternal ? '_blank' : undefined}
						rel={isExternal ? 'noopener noreferrer' : undefined}
						onMouseEnter={handleMouseEnter}
						className={`relative z-10 px-4 py-1.5 text-[13px] font-normal text-gray-500 dark:text-[#a0a0b8] hover:text-gray-900 dark:hover:text-white transition-colors duration-200 whitespace-nowrap hover:no-underline ${item.className || ''}`}
					>
						{item.label}
					</Link>
				);
			})}

			{/* Cursor highlight */}
			<span
				className="absolute z-0 top-1/2 -translate-y-1/2 h-[calc(100%-6px)] rounded-full bg-[#1a1a2e] border border-[#2a2a3d]/50 transition-all duration-300 ease-out"
				style={{
					left: cursorPosition.left,
					width: cursorPosition.width,
					opacity: cursorPosition.opacity
				}}
			/>
		</div>
	);
};

export default DesktopMenu;
