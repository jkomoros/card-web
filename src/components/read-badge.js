import { html } from '@polymer/lit-element';

import {
	VISIBILITY_ICON,
} from './my-icons.js';

import { CardBadge } from './card-badge.js';

class ReadBadge extends CardBadge {
	innerRender() {
		return html`${VISIBILITY_ICON}`;
	}
}

window.customElements.define('read-badge', ReadBadge);
