import { html } from '@polymer/lit-element';

import {
	starIcon,
} from './my-icons.js';

import { CardBadge } from './card-badge.js';

class StarCount extends CardBadge {
	innerRender() {
		return html`${starIcon} <span>${this.count}</span>`;
	}
}

window.customElements.define('star-count', StarCount);
