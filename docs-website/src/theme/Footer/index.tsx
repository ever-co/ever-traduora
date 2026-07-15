import React, { type ReactNode } from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import { useThemeConfig } from '@docusaurus/theme-common';

import { SocialLinks } from './SocialLinks';
import { SystemStatus } from './SystemStatus';
import { ThemeToggle } from './ThemeToggle';
import { FooterLinks, type FooterLinkColumn } from './FooterLinks';
import EverLogo from './EverLogo';
import LocaleDropdown from '../Navbar/LocaleDropdown';

interface FooterData {
	description: string;
	socialLinks: Array<{ title: string; href: string; icon: string }>;
	systemStatus: { status: 'normal' | 'warning' | 'error'; message: string };
	products: Array<{
		name: string;
		href: string;
		description: string;
		icon: string;
	}>;
	companyInfo: {
		copyright: string;
		disclaimer: string;
		legalLinks: Array<{ text: string; href: string }>;
	};
}

function Footer(): ReactNode {
	const { siteConfig } = useDocusaurusContext();
	const { footer } = useThemeConfig();

	if (!footer) {
		return null;
	}

	const footerData = siteConfig.customFields?.footerData as FooterData | undefined;
	const links = footer.links || [];

	return (
		<footer className="border-t border-gray-200 dark:border-gray-800/50 flex relative z-50 flex-col items-center pt-5 mt-auto bg-white dark:bg-black">
			<div className="flex flex-col w-full">
				<div className="w-full mx-auto px-4 sm:px-6 max-w-[1400px] flex flex-col mt-12">
					<div className="flex flex-wrap gap-10 justify-center items-start w-full lg:flex-nowrap lg:justify-between">
						{/* Left column with description, social links, and system status */}
						<div className="flex flex-col gap-y-5 w-full max-w-52">
							{footerData?.description && (
								<p className="text-sm text-gray-600 lg:text-base dark:text-white/60">
									{footerData.description}
								</p>
							)}
							{footerData?.socialLinks && <SocialLinks links={footerData.socialLinks} />}
							{footerData?.systemStatus && <SystemStatus {...footerData.systemStatus} />}
						</div>

						{/* Footer link columns */}
						<FooterLinks columns={links as FooterLinkColumn[]} />
					</div>
				</div>
			</div>

			{/* Bottom footer section */}
			<div className="py-6 mt-12 w-full bg-gray-50 dark:bg-black min-h-[141px]">
				<div className="mx-auto px-4 sm:px-6 grid grid-cols-1 gap-6 items-center w-full sm:grid-cols-2 md:grid-cols-4 max-w-[1400px]">
					{/* Logo Section */}
					<div className="flex items-center gap-4 text-gray-600 dark:text-[#565656] transition-colors col-span-1 duration-300 md:col-start-1">
						<EverLogo className="text-gray-300 dark:text-[#ffffff30] dark:hover:text-[#ffffff50] transition-colors duration-300" />
					</div>

					{/* Legal Section */}
					{footerData?.companyInfo && (
						<div className="flex flex-col col-span-2 text-zinc-600 dark:text-zinc-400 md:col-start-2 md:row-start-1">
							<div className="flex flex-wrap gap-4 justify-center md:items-center xl:flex-nowrap md:justify-between">
								<span className="text-[11px] sm:text-xs lg:text-nowrap lg:whitespace-nowrap text-[#231645]/50 dark:text-[#9CA3AF]">
									{footerData.companyInfo.copyright}
								</span>
								<div className="flex flex-wrap gap-2 items-center lg:flex-nowrap sm:gap-3 md:gap-4">
									{footerData.companyInfo.legalLinks?.map((link, index) => (
										<a
											key={index}
											href={link.href}
											target="_blank"
											rel="noopener noreferrer"
											className="text-[#231645]/50 hover:underline dark:text-[#9CA3AF] duration-300 ease-in-out hover:text-gray-900 dark:hover:text-zinc-300 text-[11px] sm:text-xs lg:text-nowrap lg:whitespace-nowrap transition-colors"
										>
											{link.text}
										</a>
									))}
								</div>
							</div>
							<p className="mt-3 text-[10px] text-[#231645]/50 dark:text-[#9CA3AF]/60">
								{footerData.companyInfo.disclaimer}
							</p>
						</div>
					)}

					{/* Theme Toggle and Locale Dropdown */}
					<div className="flex col-span-1 col-start-2 gap-1 items-end md:gap-4 sm:items-center sm:justify-center md:col-start-4 md:row-start-1">
						<LocaleDropdown />
						<ThemeToggle />
					</div>
				</div>
			</div>
		</footer>
	);
}

export default React.memo(Footer);
