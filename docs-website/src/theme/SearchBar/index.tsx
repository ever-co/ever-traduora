import React, { useState, useEffect, useRef, useCallback, JSX } from 'react';
import { useHistory } from '@docusaurus/router';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import useIsBrowser from '@docusaurus/useIsBrowser';

// Icons
const SearchIcon = () => (
	<svg className="w-4 h-4 text-[#808098]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
		<path
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth={2}
			d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
		/>
	</svg>
);

const CloseIcon = () => (
	<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
		<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
	</svg>
);

const DocIcon = () => (
	<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
		<path
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth={2}
			d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
		/>
	</svg>
);

interface SearchResult {
	document: {
		u: string; // URL
		t: string; // Title
		h?: string; // Heading hash
		s?: string; // Snippet/content
	};
	tokens: string[];
}

export default function SearchBar(): JSX.Element {
	const isBrowser = useIsBrowser();
	const history = useHistory();
	const {
		siteConfig: { baseUrl },
		i18n: { currentLocale, defaultLocale }
	} = useDocusaurusContext();

	// Compute the locale-aware base URL for search index loading
	// For non-default locales, prepend the locale path (e.g., "/fr/")
	const searchBaseUrl = currentLocale !== defaultLocale ? `${baseUrl}${currentLocale}/` : baseUrl;

	const [isOpen, setIsOpen] = useState(false);
	const [query, setQuery] = useState('');
	const [results, setResults] = useState<SearchResult[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [isLoading, setIsLoading] = useState(false);
	const [indexLoaded, setIndexLoaded] = useState(false);
	const [indexLoading, setIndexLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const inputRef = useRef<HTMLInputElement>(null);
	const modalRef = useRef<HTMLDivElement>(null);

	// Detect macOS for keyboard shortcut hint
	const isMac = isBrowser ? /mac/i.test((navigator as any).userAgentData?.platform ?? navigator.platform) : false;

	// Open modal
	const openModal = useCallback(() => {
		setIsOpen(true);
		setQuery('');
		setResults([]);
		setSelectedIndex(0);
	}, []);

	// Close modal
	const closeModal = useCallback(() => {
		setIsOpen(false);
		setQuery('');
		setResults([]);
	}, []);

	// Load search index
	const loadIndex = useCallback(async () => {
		if (indexLoaded || indexLoading || !isBrowser) return;

		try {
			setIndexLoading(true);
			setError(null);
			// Dynamically import the search worker functions
			const { fetchIndexesByWorker } =
				await import('@easyops-cn/docusaurus-search-local/dist/client/client/theme/searchByWorker');
			// Use searchBaseUrl to load the correct locale-specific search index
			await fetchIndexesByWorker(searchBaseUrl, '');
			setIndexLoaded(true);
		} catch (err) {
			console.error('Failed to load search index:', err);
			setError('Failed to load search index. Please try rebuilding the site.');
		} finally {
			setIndexLoading(false);
		}
	}, [searchBaseUrl, indexLoaded, indexLoading, isBrowser]);

	// Perform search
	const performSearch = useCallback(
		async (searchQuery: string) => {
			if (!searchQuery.trim() || !isBrowser) {
				setResults([]);
				return;
			}

			// Wait for index to be loaded before searching
			if (!indexLoaded) {
				// Index not ready yet - search will be triggered again when index loads
				return;
			}

			try {
				setIsLoading(true);
				setError(null);
				const { searchByWorker } =
					(await import('@easyops-cn/docusaurus-search-local/dist/client/client/theme/searchByWorker')) as {
						searchByWorker: (
							baseUrl: string,
							searchContext: string,
							input: string,
							limit: number
						) => Promise<SearchResult[]>;
					};

				// Use searchBaseUrl to search the correct locale-specific index
				// The limit parameter (8) is required - it specifies max number of results
				const searchResults = await searchByWorker(
					searchBaseUrl,
					'',
					searchQuery,
					8 // searchResultLimits - max number of search results
				);
				setResults(searchResults || []);
				setSelectedIndex(0);
			} catch (err) {
				console.error('Search error:', err);
				setError('Search failed. Please try again.');
				setResults([]);
			} finally {
				setIsLoading(false);
			}
		},
		[searchBaseUrl, isBrowser, indexLoaded]
	);

	// Debounced search - also triggers when index finishes loading
	useEffect(() => {
		if (!query) {
			setResults([]);
			return;
		}

		// If index is not loaded yet, don't set up the timer
		if (!indexLoaded) {
			return;
		}

		const timer = setTimeout(() => {
			performSearch(query);
		}, 150);

		return () => clearTimeout(timer);
	}, [query, performSearch, indexLoaded]);

	// Navigate to result
	const navigateToResult = useCallback(
		(result: SearchResult) => {
			let url = result.document.u;
			// Only navigate to relative paths — reject absolute URLs to prevent open redirect
			if (!url.startsWith('/')) {
				return;
			}
			if (result.document.h) {
				url += result.document.h;
			}
			closeModal();
			history.push(url);
		},
		[closeModal, history]
	);

	// Keyboard navigation
	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			switch (e.key) {
				case 'ArrowDown':
					e.preventDefault();
					setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : prev));
					break;
				case 'ArrowUp':
					e.preventDefault();
					setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
					break;
				case 'Enter':
					e.preventDefault();
					if (results[selectedIndex]) {
						navigateToResult(results[selectedIndex]);
					}
					break;
				case 'Escape':
					e.preventDefault();
					closeModal();
					break;
			}
		},
		[results, selectedIndex, navigateToResult, closeModal]
	);

	// Global keyboard shortcut (Cmd+K / Ctrl+K)
	useEffect(() => {
		if (!isBrowser) return;

		const handleGlobalKeyDown = (e: KeyboardEvent) => {
			if ((isMac ? e.metaKey : e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
				e.preventDefault();
				if (isOpen) {
					closeModal();
				} else {
					openModal();
					loadIndex();
				}
			}
		};

		document.addEventListener('keydown', handleGlobalKeyDown);
		return () => document.removeEventListener('keydown', handleGlobalKeyDown);
	}, [isBrowser, isMac, isOpen, closeModal, openModal, loadIndex]);

	// Focus input when modal opens
	useEffect(() => {
		if (isOpen && inputRef.current) {
			inputRef.current.focus();
			loadIndex();
		}
	}, [isOpen, loadIndex]);

	// Prevent body scroll when modal is open
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

	// Click outside to close
	useEffect(() => {
		if (!isOpen) return;

		const handleClickOutside = (e: MouseEvent) => {
			if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
				closeModal();
			}
		};

		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [isOpen, closeModal]);

	return (
		<>
			{/* Search Trigger Button */}
			<button
				onClick={() => {
					openModal();
					loadIndex();
				}}
				className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-full border border-gray-200 dark:border-[#2a2a3d] bg-gray-100 dark:bg-[#0d0d15]/80 text-gray-500 dark:text-[#808098] hover:text-gray-700 dark:hover:text-[#b0b0c8] hover:border-gray-300 dark:hover:border-[#3a3a5d] backdrop-blur-sm transition-all duration-200 min-w-[160px]"
				aria-label="Search documentation"
			>
				<SearchIcon />
				<span className="flex-1 text-left text-[13px]">Search...</span>
				<kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 dark:text-[#606078] bg-gray-200 dark:bg-[#1a1a2e] rounded border border-gray-300 dark:border-[#2a2a3d]">
					{isMac ? '⌘' : 'Ctrl'}K
				</kbd>
			</button>

			{/* Search Modal */}
			{isOpen && (
				<div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[10vh] px-4 animate-fade-in">
					{/* Backdrop */}
					<div className="absolute inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm" />

					{/* Modal */}
					<div
						ref={modalRef}
						className="relative w-full max-w-2xl bg-white dark:bg-black rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden animate-slide-up"
						onKeyDown={handleKeyDown}
					>
						{/* Search Input */}
						<div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
							<SearchIcon />
							<input
								ref={inputRef}
								type="text"
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								placeholder="Search documentation..."
								className="flex-1 bg-transparent text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none text-base"
								autoComplete="off"
								autoCorrect="off"
								autoCapitalize="off"
								spellCheck="false"
							/>
							{query && (
								<button
									onClick={() => setQuery('')}
									className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
								>
									<CloseIcon />
								</button>
							)}
							<button
								onClick={closeModal}
								className="px-2 py-1 text-xs font-medium text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
							>
								ESC
							</button>
						</div>

						{/* Results */}
						<div className="max-h-[60vh] overflow-y-auto">
							{/* Error state */}

							{error && (
								<div className="flex flex-col items-center justify-center py-12 text-red-500 dark:text-red-400">
									<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
										/>
									</svg>
									<p className="mt-4 text-sm">{error}</p>
								</div>
							)}

							{/* Loading state - show when loading index or searching */}
							{!error && (isLoading || indexLoading) && (
								<div className="flex flex-col items-center justify-center py-8">
									<div className="w-6 h-6 border-2 border-gray-300 dark:border-gray-600 border-t-purple-500 rounded-full animate-spin" />
									<p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
										{indexLoading ? 'Loading search index...' : 'Searching...'}
									</p>
								</div>
							)}

							{/* No results found */}
							{!error && !isLoading && !indexLoading && results.length === 0 && query && indexLoaded && (
								<div className="flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-400">
									<SearchIcon />
									<p className="mt-4 text-sm">No results found for &quot;{query}&quot;</p>
									{process.env.NODE_ENV !== 'production' && (
										<div className="mt-4 px-4 py-2 bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded-lg text-amber-800 dark:text-amber-200 text-xs text-center max-w-sm">
											<strong>Note:</strong> Search only works in production. Run{' '}
											<code className="px-1 py-0.5 bg-amber-200 dark:bg-amber-800 rounded">
												npm run build && npm run serve
											</code>{' '}
											to test.
										</div>
									)}
								</div>
							)}

							{/* Initial state - no query */}
							{!error && !isLoading && !indexLoading && results.length === 0 && !query && (
								<div className="flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-400">
									<p className="text-sm">Start typing to search...</p>
									<div className="flex items-center gap-4 mt-4 text-xs">
										<span className="flex items-center gap-1">
											<kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">↑↓</kbd>
											Navigate
										</span>
										<span className="flex items-center gap-1">
											<kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">↵</kbd>
											Select
										</span>
										<span className="flex items-center gap-1">
											<kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">
												Esc
											</kbd>
											Close
										</span>
									</div>
								</div>
							)}

							{!isLoading && results.length > 0 && (
								<ul className="p-2">
									{results.map((result, index) => (
										<li key={`${result.document.u}-${index}`}>
											<button
												onClick={() => navigateToResult(result)}
												className={`w-full flex items-start gap-3 p-3 rounded-lg text-left ${
													index === selectedIndex
														? 'bg-gradient-to-r from-purple-500/10 to-cyan-500/10 dark:from-purple-500/20 dark:to-cyan-500/20 border border-purple-300/50 dark:border-purple-500/30'
														: 'hover:bg-gray-100 dark:hover:bg-gray-800/50'
												}`}
												onMouseEnter={() => setSelectedIndex(index)}
											>
												<div
													className={`flex-shrink-0 p-1.5 rounded-lg ${
														index === selectedIndex
															? 'bg-purple-500/20 text-purple-600 dark:text-purple-400'
															: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
													}`}
												>
													<DocIcon />
												</div>
												<div className="flex-1 min-w-0">
													<div
														className={`font-medium truncate ${
															index === selectedIndex
																? 'text-purple-700 dark:text-purple-300'
																: 'text-gray-900 dark:text-white'
														}`}
													>
														{result.document.t}
													</div>
													{result.document.s && (
														<div className="text-sm text-gray-500 dark:text-gray-400 truncate mt-0.5">
															{result.document.s}
														</div>
													)}
												</div>
												{index === selectedIndex && (
													<div className="flex-shrink-0 text-purple-500 dark:text-purple-400">
														<svg
															className="w-4 h-4"
															fill="none"
															viewBox="0 0 24 24"
															stroke="currentColor"
														>
															<path
																strokeLinecap="round"
																strokeLinejoin="round"
																strokeWidth={2}
																d="M13 7l5 5m0 0l-5 5m5-5H6"
															/>
														</svg>
													</div>
												)}
											</button>
										</li>
									))}
								</ul>
							)}
						</div>

						{/* Footer */}
						<div className="flex items-center justify-end px-4 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-xs text-gray-500 dark:text-gray-400">
							<span className="flex items-center gap-2">
								<span className="hidden sm:inline">
									Press{' '}
									<kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">
										{isMac ? '⌘' : 'Ctrl'}K
									</kbd>{' '}
									to toggle
								</span>
							</span>
						</div>
					</div>
				</div>
			)}
		</>
	);
}
