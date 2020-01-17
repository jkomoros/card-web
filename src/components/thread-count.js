import { html } from '@polymer/lit-element';

import {
	forumIcon,
} from './my-icons.js';

import { CardBadge } from './card-badge.js';

class ThreadCount extends CardBadge {
	innerRender() {
		return html`${forumIcon} <span>${this.count}</span>`;
	}
}

window.customElements.define('thread-count', ThreadCount);
