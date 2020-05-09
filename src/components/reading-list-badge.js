import { html } from '@polymer/lit-element';

import {
	PLAYLISLT_ADD_CHECK_ICON,
} from './my-icons.js';

import { CardBadge } from './card-badge.js';

class ReadingListBadge extends CardBadge {
	innerRender() {
		return html`${PLAYLISLT_ADD_CHECK_ICON}`;
	}
}

window.customElements.define('reading-list-badge', ReadingListBadge);
