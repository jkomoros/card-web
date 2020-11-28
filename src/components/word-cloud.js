import { html, LitElement } from '@polymer/lit-element';

import {
	emptyWordCloud
} from '../nlp.js';

import './tag-list.js';

// This element is *not* connected to the Redux store.
export class WordCloud extends LitElement {
	render() {
		return html`
		<tag-list .tags=${this.wordCloud[0]} .tagInfos=${this.wordCloud[1]} defaultColor='#5e2b97'></tag-list>
	`;
	}

	constructor() {
		super();
		this.wordCloud = emptyWordCloud();
	}

	static get properties() {
		return {
			wordCloud: {type:Object},
		};
	}

}

window.customElements.define('word-cloud', WordCloud);
