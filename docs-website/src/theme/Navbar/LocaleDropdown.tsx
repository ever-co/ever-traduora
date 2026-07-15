import React, { useState, useRef, useEffect } from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import { useAlternatePageUtils } from '@docusaurus/theme-common/internal';

const LanguageIcon = () => (
	<svg viewBox="0 0 24 24" width={18} height={18} aria-hidden fill="currentColor">
		<path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z" />
	</svg>
);

const ChevronDownIcon = () => (
	<svg className="w-4 h-4 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
		<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
	</svg>
);

const LocaleDropdown: React.FC = () => {
	const [isOpen, setIsOpen] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);

	const {
		i18n: { currentLocale, locales, localeConfigs }
	} = useDocusaurusContext();

	const alternatePageUtils = useAlternatePageUtils();

	// Close dropdown when clicking outside
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
				setIsOpen(false);
			}
		};

		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, []);

	// Close on escape key
	useEffect(() => {
		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				setIsOpen(false);
			}
		};

		document.addEventListener('keydown', handleEscape);
		return () => document.removeEventListener('keydown', handleEscape);
	}, []);

	const getLocaleLabel = (locale: string) => {
		return localeConfigs[locale]?.label || locale.toUpperCase();
	};

	const getLocaleUrl = (locale: string) => {
		try {
			return alternatePageUtils.createUrl({ locale, fullyQualified: false });
		} catch {
			// Fallback: if page doesn't exist in target locale, go to locale root
			if (locale === currentLocale || locale === 'en') {
				return '/';
			}
			return `/${locale}/`;
		}
	};

	return (
		<div className="relative" ref={dropdownRef}>
			{/* Trigger Button */}
			<button
				onClick={() => setIsOpen(!isOpen)}
				className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:border-gray-300 dark:hover:border-gray-600 hover:bg-white/80 dark:hover:bg-gray-800/80 backdrop-blur-sm transition-all duration-200 shadow-sm"
				aria-label="Select language"
				aria-expanded={isOpen}
			>
				<LanguageIcon />
				<span className="hidden md:inline">{currentLocale.toUpperCase()}</span>
				<ChevronDownIcon />
			</button>

			{/* Dropdown Menu */}
			{isOpen && (
				<div className="absolute right-0 bottom-full mb-2 py-2 min-w-[160px] max-h-[300px] overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-black shadow-lg animate-fade-in z-[200]">
					{locales.map((locale) => (
						<a
							key={locale}
							href={getLocaleUrl(locale)}
							onClick={() => setIsOpen(false)}
							className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors duration-150 ${
								locale === currentLocale
									? 'bg-gradient-to-r from-purple-500/10 to-cyan-500/10 text-purple-600 dark:text-purple-400 font-medium'
									: 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
							}`}
						>
							<span className="flex-1">{getLocaleLabel(locale)}</span>
							{locale === currentLocale && (
								<svg
									className="w-4 h-4 text-purple-500"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M5 13l4 4L19 7"
									/>
								</svg>
							)}
						</a>
					))}
				</div>
			)}
		</div>
	);
};

export default LocaleDropdown;
