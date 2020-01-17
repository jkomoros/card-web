import { html } from '@polymer/lit-element';

import {
	assignmentTurnedInIcon,
} from './my-icons.js';

import { CardBadge } from './card-badge.js';

class TodoDecorator extends CardBadge {
	innerRender() {
		return html`${assignmentTurnedInIcon}`;
	}
}

window.customElements.define('todo-decorator', TodoDecorator);
