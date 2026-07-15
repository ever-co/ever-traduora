import React from 'react';
import { useColorMode } from '@docusaurus/theme-common';

export function ThemeToggle(): React.ReactElement {
	const { colorMode, setColorMode } = useColorMode();

	const onThemeToggle = () => {
		setColorMode(colorMode === 'dark' ? 'light' : 'dark');
	};

	return (
		<button
			onClick={onThemeToggle}
			className="flex gap-3 items-center px-2 py-1.5 bg-[#D7DAE0] dark:bg-[#1D222A] rounded-full relative max-h-fit"
			aria-label="Toggle theme"
		>
			<span
				className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center ${
					colorMode === 'light' ? 'bg-[#AFB6C1] text-[#231645]' : 'bg-transparent text-white'
				}`}
			>
				<svg
					className="w-3 h-3 sm:w-[18px] sm:h-[18px]"
					width={19}
					height={19}
					viewBox="0 0 19 19"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
				>
					<path
						d="M9.01367 14.3809C11.7061 14.3809 13.8887 12.1982 13.8887 9.50586C13.8887 6.81347 11.7061 4.63086 9.01367 4.63086C6.32128 4.63086 4.13867 6.81347 4.13867 9.50586C4.13867 12.1982 6.32128 14.3809 9.01367 14.3809Z"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
					<path
						d="M14.3687 14.8609L14.2712 14.7634M14.2712 4.24836L14.3687 4.15086L14.2712 4.24836ZM3.65867 14.8609L3.75617 14.7634L3.65867 14.8609ZM9.01367 2.06586V2.00586V2.06586ZM9.01367 17.0059V16.9459V17.0059ZM1.57367 9.50586H1.51367H1.57367ZM16.5137 9.50586H16.4537H16.5137ZM3.75617 4.24836L3.65867 4.15086L3.75617 4.24836Z"
						stroke="currentColor"
						strokeWidth={2}
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			</span>

			<span
				className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center ${
					colorMode === 'dark' ? 'bg-[#3B4454] text-white' : 'bg-transparent text-[#231645]'
				}`}
			>
				<svg
					className="w-3 h-3 sm:w-[18px] sm:h-[18px]"
					width={19}
					height={19}
					viewBox="0 0 19 19"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
				>
					<path
						d="M16.1602 12.4529C16.0402 12.2504 15.7027 11.9354 14.8627 12.0854C14.3977 12.1679 13.9252 12.2054 13.4527 12.1829C11.7052 12.1079 10.1227 11.3054 9.02022 10.0679C8.04522 8.9804 7.44522 7.5629 7.43772 6.0329C7.43772 5.1779 7.60272 4.3529 7.94022 3.5729C8.27022 2.8154 8.03772 2.4179 7.87272 2.2529C7.70022 2.0804 7.29522 1.8404 6.50022 2.1704C3.43272 3.4604 1.53522 6.5354 1.76022 9.8279C1.98522 12.9254 4.16022 15.5729 7.04022 16.5704C7.73022 16.8104 8.45772 16.9529 9.20772 16.9829C9.32772 16.9904 9.44772 16.9979 9.56772 16.9979C12.0802 16.9979 14.4352 15.8129 15.9202 13.7954C16.4227 13.0979 16.2877 12.6554 16.1602 12.4529Z"
						fill="currentColor"
					/>
				</svg>
			</span>
		</button>
	);
}
