import { html } from '@polymer/lit-element';

import {
	FORUM_ICON,
} from './my-icons.js';

import { CardBadge } from './card-badge.js';

class ThreadCount extends CardBadge {
	innerRender() {
		return html`${FORUM_ICON} <span>${this.count}</span>`;
	}
}

window.customElements.define('thread-count', ThreadCount);
