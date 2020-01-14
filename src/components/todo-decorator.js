import { html } from '@polymer/lit-element';

import {
	assignmentTurnedInIcon,
} from './my-icons.js';

import { CardDecorator } from './card-decorator.js';

class TodoDecorator extends CardDecorator {
	innerRender() {
		return html`${assignmentTurnedInIcon}`;
	}
}

window.customElements.define('todo-decorator', TodoDecorator);
