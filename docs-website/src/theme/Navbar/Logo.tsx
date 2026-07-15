import React from 'react';

interface LogoProps {
	className?: string;
}

/**
 * traduora navbar logo — the rounded-blue-square "t" brand mark plus the
 * lowercase "traduora" wordmark. The mark keeps traduora's blue (#3b84f8)
 * identity; the wordmark inherits the theme text color.
 */
export const Logo: React.FC<LogoProps> = ({ className = '' }) => {
	return (
		<a
			href="/"
			aria-label="traduora — Go to homepage"
			className={`text-current flex items-center gap-2.5 ${className}`}
		>
			<img
				src="/img/logo.png"
				alt="traduora"
				width={32}
				height={32}
				className="size-8 rounded-lg shrink-0"
			/>
			<span className="text-[22px] font-semibold tracking-tight lowercase text-[#231645] dark:text-white">
				traduora
			</span>
		</a>
	);
};

export default Logo;
