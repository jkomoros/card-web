import { html } from '@polymer/lit-element';

import {
	ASSIGNMENT_TURNED_IN_ICON,
} from './my-icons.js';

import { CardBadge } from './card-badge.js';

class TodoBadge extends CardBadge {
	innerRender() {
		return html`${ASSIGNMENT_TURNED_IN_ICON}`;
	}
}

window.customElements.define('todo-badge', TodoBadge);
