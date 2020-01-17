import { html } from '@polymer/lit-element';

import {
	assignmentTurnedInIcon,
} from './my-icons.js';

import { CardBadge } from './card-badge.js';

class TodoBadge extends CardBadge {
	innerRender() {
		return html`${assignmentTurnedInIcon}`;
	}
}

window.customElements.define('todo-badge', TodoBadge);
