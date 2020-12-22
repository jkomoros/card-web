import { html, LitElement } from '@polymer/lit-element';

import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import {
	emptyWordCloud
} from '../nlp.js';

import {
	navigateToCollectionWithQuery,
	navigateToCollectionWithAbout,
} from '../actions/app.js';

import './tag-list.js';

export class WordCloud extends connect(store)(LitElement) {
	render() {
		return html`
		<tag-list .tags=${this._effectiveWordCloud[0]} .tagInfos=${this._effectiveWordCloud[1]} defaultColor='var(--app-primary-color)' .tapEvents=${true} @tag-tapped=${this._handleTagTapped}></tag-list>
	`;
	}

	get _effectiveWordCloud() {
		return this.wordCloud || emptyWordCloud();
	}

	_handleTagTapped(e) {
		const tagName = e.detail.tag;
		const tagInfos = this._effectiveWordCloud[1];
		const infoForTag = tagInfos[tagName];
		const query = infoForTag ? infoForTag.title : tagName;
		if (infoForTag && infoForTag.color) {
			//Concept pivot
			store.dispatch(navigateToCollectionWithAbout(tagName));
		} else {
			//query pivot
			store.dispatch(navigateToCollectionWithQuery(query.toLowerCase()));
		}
		
	}

	static get properties() {
		return {
			wordCloud: {type:Object},
		};
	}

}

window.customElements.define('word-cloud', WordCloud);
