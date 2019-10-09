import { html } from '@polymer/lit-element';

import {
	playlistAddCheckIcon,
} from './my-icons.js';

import { CardDecorator } from './card-decorator.js';

class ReadingListDecorator extends CardDecorator {
	innerRender() {
		return html`${playlistAddCheckIcon}`;
	}
}

window.customElements.define('reading-list-decorator', ReadingListDecorator);
