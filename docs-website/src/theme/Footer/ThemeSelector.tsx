import React, { type ReactNode } from 'react';
import { useColorMode } from '@docusaurus/theme-common';
import useIsBrowser from '@docusaurus/useIsBrowser';
import { translate } from '@docusaurus/Translate';
import IconSystemColorMode from '@theme/Icon/SystemColorMode';
import IconLightMode from '@theme/Icon/LightMode';
import IconDarkMode from '@theme/Icon/DarkMode';

type ColorModeChoice = ReturnType<typeof useColorMode>['colorModeChoice'];

interface Option {
	choice: ColorModeChoice;
	label: string;
	Icon: typeof IconLightMode;
}

function useOptions(): Option[] {
	return [
		{
			choice: null,
			label: translate({
				id: 'theme.footer.themeSelector.system',
				message: 'System theme',
				description: 'The footer theme selector option that follows the OS theme'
			}),
			Icon: IconSystemColorMode
		},
		{
			choice: 'light',
			label: translate({
				id: 'theme.footer.themeSelector.light',
				message: 'Light theme',
				description: 'The footer theme selector option for the light theme'
			}),
			Icon: IconLightMode
		},
		{
			choice: 'dark',
			label: translate({
				id: 'theme.footer.themeSelector.dark',
				message: 'Dark theme',
				description: 'The footer theme selector option for the dark theme'
			}),
			Icon: IconDarkMode
		}
	];
}

/**
 * Footer theme selector: System / Light / Dark, the current choice pressed. It replaces the
 * light/dark ThemeToggle, which had no way back to following the OS theme.
 *
 * `colorModeChoice` is null while the visitor has not picked a theme; the site then follows the
 * OS theme (respectPrefersColorScheme), and `setColorMode(null)` goes back to that.
 *
 * The server and the first client render are the same: no option is pressed until React has
 * hydrated and read the stored choice, so the static HTML never claims a choice.
 */
export function ThemeSelector(): ReactNode {
	const { colorModeChoice, setColorMode } = useColorMode();
	const isBrowser = useIsBrowser();
	const options = useOptions();

	return (
		<div
			role="group"
			aria-label={translate({
				id: 'theme.footer.themeSelector.label',
				message: 'Theme',
				description: 'The ARIA label of the footer theme selector'
			})}
			className="flex gap-1 items-center p-1 bg-[#D7DAE0] dark:bg-[#1D222A] rounded-full max-h-fit"
		>
			{options.map(({ choice, label, Icon }) => (
				<button
					key={choice ?? 'system'}
					type="button"
					aria-label={label}
					title={label}
					aria-pressed={isBrowser && colorModeChoice === choice}
					onClick={() => setColorMode(choice)}
					className="flex justify-center items-center w-8 h-8 pointer-coarse:w-11 pointer-coarse:h-11 rounded-full border-0 bg-transparent cursor-pointer text-[#231645]/70 dark:text-white/60 hover:text-[#231645] dark:hover:text-white aria-pressed:bg-[#AFB6C1] aria-pressed:text-[#231645] dark:aria-pressed:bg-[#3B4454] dark:aria-pressed:text-white forced-colors:aria-pressed:border-2 forced-colors:aria-pressed:border-[color:CanvasText] transition-colors duration-200 outline-hidden focus-visible:ring-2 focus-visible:ring-[#5468ff]"
				>
					<Icon aria-hidden className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
				</button>
			))}
		</div>
	);
}
