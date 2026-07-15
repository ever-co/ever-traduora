import React from 'react';

interface SystemStatusProps {
	status: 'normal' | 'warning' | 'error';
	message: string;
}

export function SystemStatus({ status, message }: SystemStatusProps): React.ReactElement {
	const statusColors = {
		normal: 'bg-green-300',
		warning: 'bg-yellow-300',
		error: 'bg-red-300'
	};

	const pulseColors = {
		normal: 'bg-green-500',
		warning: 'bg-yellow-500',
		error: 'bg-red-500'
	};

	return (
		<div className="outline-none transition duration-150 ease-in-out focus-visible:ring-2 group relative flex w-fit items-center gap-x-1 md:gap-x-2.5 overflow-hidden rounded-full border border-gray-200 dark:border-white/5 pl-1 md:pl-3.5 pr-2 md:pr-4 py-2 text-xs bg-white dark:bg-transparent">
			<div className="absolute inset-0 bg-white dark:bg-transparent opacity-10 transition-opacity duration-300 group-hover:opacity-15" />
			<div className="absolute inset-0 bg-white dark:bg-transparent rounded-full opacity-5 transition-opacity duration-150 ease-linear group-hover:opacity-10" />
			<span
				className={`relative flex animate-pulse items-center justify-center w-3 h-3 rounded-full z-10 ${statusColors[status]} transition-colors ease-in-out`}
			>
				<span
					className={`absolute animate-pulse-scale z-20 w-1.5 h-1.5 left-1/2 top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full ${pulseColors[status]} opacity-55`}
				/>
			</span>
			<span className="text-[10px] sm:text-xs whitespace-nowrap text-gray-900 dark:text-white">{message}</span>
		</div>
	);
}
