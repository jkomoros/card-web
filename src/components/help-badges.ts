import { html, css } from 'lit';
import { classMap } from 'lit/directives/class-map.js';

import {
	WARNING_ICON,
	HELP_ICON,
} from '../../shared/icons.js';

//if you use help, also print out helpStyles
//
//THE BADGE IS REACHABLE, NOT ONLY HOVERABLE.
//
//It carried its whole explanation in a `title` and nothing else, so on a touch
//device and from the keyboard the sentence did not exist — HOUSE-STYLE §3.6.4
//is explicit that a hover-only explanation is unreachable on touch, and §2.5
//pairs `title` with `aria-label` for every icon that has something to say. The
//title stays (it is what a sighted mouse user gets); the tabindex puts the badge
//in the tab order so the same sentence can be reached by keyboard, and the
//aria-label is what a screen reader reads when it lands there.
//
//role='note' rather than 'img' or 'button': it is a remark about the thing
//beside it, and it does nothing when activated. Fixed in the PRIMITIVE rather
//than at one call site, because all 29 badges in the app have the same problem
//and a local copy is exactly the divergence §5 exists to prevent.
export const help = (message : string, isAlert? : boolean, isStrong? : boolean) => {
	const classes = {help: true, strong: isStrong || false};
	return html`<span class=${classMap(classes)} tabindex='0' role='note' aria-label=${message} title="${message}">${isAlert ? WARNING_ICON : HELP_ICON}</span>`;
};

export const HelpStyles =  css`
	.help {
		display: inline-flex;
		margin-left:0.4em;
	}

	/* ButtonSharedStyles strips the UA focus ring app-wide, and this badge is
	   now a tab stop — without a ring, tabbing onto it would look like focus
	   vanishing. Same 2px primary outline the app's other keyboard-only
	   affordances use. */
	.help:focus-visible {
		outline: 2px solid var(--app-primary-color);
		outline-offset: 1px;
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