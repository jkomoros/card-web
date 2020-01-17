import { html } from '@polymer/lit-element';

import {
	visibilityIcon,
} from './my-icons.js';

import { CardBadge } from './card-badge.js';

class ReadDecorator extends CardBadge {
	innerRender() {
		return html`${visibilityIcon}`;
	}
}

window.customElements.define('read-decorator', ReadDecorator);
