import { LitElement, html } from '@polymer/lit-element';

import {
	forumIcon,
} from './my-icons.js';

import { SharedStyles } from './shared-styles.js';

import { CardDecorator } from './card-decorator.js';

class ThreadCount extends CardDecorator {
	innerRender() {
		return html`${forumIcon} <span>${this.count}</span>`;
	}
}

window.customElements.define('thread-count', ThreadCount);
