import { html, css } from 'lit';
import { classMap } from 'lit/directives/class-map.js';

import {
	WARNING_ICON,
	HELP_ICON,
} from '../../shared/icons.js';

//if you use help, also print out helpStyles
export const help = (message : string, isAlert? : boolean, isStrong? : boolean) => {
	const classes = {help: true, strong: isStrong || false};
	return html`<span class=${classMap(classes)} title="${message}">${isAlert ? WARNING_ICON : HELP_ICON}</span>`;
};

export const HelpStyles =  css`
	.help {
		margin-left:0.4em;
	}

	.help svg {
		height:1.3em;
		width:1.3em;
		fill: var(--app-dark-text-color-subtle);
	}

	.help.strong svg {
		fill: var(--app-warning-color, firebrick);
	}
`;