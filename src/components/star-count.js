import { html } from '@polymer/lit-element';

import {
	starIcon,
} from './my-icons.js';

import { CardDecorator } from './card-decorator.js';

class StarCount extends CardDecorator {
	innerRender() {
		return html`${starIcon} <span>${this.count}</span>`;
	}
}

window.customElements.define('star-count', StarCount);
