declare module '@easyops-cn/docusaurus-search-local/dist/client/client/theme/searchByWorker' {
	export function fetchIndexesByWorker(baseUrl: string, searchContext: string): Promise<void>;

	export function searchByWorker(
		baseUrl: string,
		searchContext: string,
		query: string
	): Promise<
		Array<{
			document: {
				u: string;
				t: string;
				h?: string;
				s?: string;
			};
			tokens: string[];
		}>
	>;
}
