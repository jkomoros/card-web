import { html } from '@polymer/lit-element';

import {
	playlistAddCheckIcon,
} from './my-icons.js';

import { CardBadge } from './card-badge.js';

class ReadingListDecorator extends CardBadge {
	innerRender() {
		return html`${playlistAddCheckIcon}`;
	}
}

window.customElements.define('reading-list-decorator', ReadingListDecorator);
