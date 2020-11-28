import { html, LitElement } from '@polymer/lit-element';

import {
	emptyWordCloud
} from '../nlp.js';

import './tag-list.js';

// This element is *not* connected to the Redux store.
export class WordCloud extends LitElement {
	render() {
		return html`
		<!-- --app-primary-color default color -->
		<tag-list .tags=${this._effectiveWordCloud[0]} .tagInfos=${this._effectiveWordCloud[1]} defaultColor='#5e2b97'></tag-list>
	`;
	}

	get _effectiveWordCloud() {
		return this.wordCloud || emptyWordCloud();
	}

	static get properties() {
		return {
			wordCloud: {type:Object},
		};
	}

}

window.customElements.define('word-cloud', WordCloud);
