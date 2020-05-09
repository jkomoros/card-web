import { html } from '@polymer/lit-element';

import {
	STAR_ICON,
} from './my-icons.js';

import { CardBadge } from './card-badge.js';

class StarCount extends CardBadge {
	innerRender() {
		return html`${STAR_ICON} <span>${this.count}</span>`;
	}
}

window.customElements.define('star-count', StarCount);
