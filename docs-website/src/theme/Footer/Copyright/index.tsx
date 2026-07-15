import React from 'react';
import { useThemeConfig } from '@docusaurus/theme-common';
import type { Props } from '@theme/Footer/Copyright';

export default function FooterCopyright({ copyright }: Props): JSX.Element {
	return (
		<div
			className="footer__copyright"
			// Developer provided the HTML, so assume it's safe.
			// eslint-disable-next-line react/no-danger
			dangerouslySetInnerHTML={{
				__html: copyright
					? copyright.replace(
							'Ever Co. LTD.',
							'<a href="https://ever.co/" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">Ever Co. LTD.</a>'
						)
					: ''
			}}
		/>
	);
}
