import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import {
	emptyWordCloud
} from '../nlp.js';

import {
	navigateToCollectionWithQuery,
	navigateToCollectionWithAboutConcept,
} from '../actions/app.js';

import './tag-list.js';

import {
	WordCloud as WordCloudType,
} from '../types.js';

import {
	TagEvent
} from '../events.js';

@customElement('word-cloud')
export class WordCloud extends connect(store)(LitElement) {

	@property({ type : Array })
		wordCloud: WordCloudType | null;

	override render() {
		return html`
		<tag-list .tags=${this._effectiveWordCloud[0]} .tagInfos=${this._effectiveWordCloud[1]} defaultColor='var(--app-primary-color)' .tapEvents=${true} @tag-tapped=${this._handleTagTapped}></tag-list>
	`;
	}

	get _effectiveWordCloud() {
		return this.wordCloud || emptyWordCloud();
	}

	_handleTagTapped(e : TagEvent) {
		const tagName = e.detail.tag;
		const tagInfos = this._effectiveWordCloud[1];
		const infoForTag = tagInfos[tagName];
		const query = infoForTag ? infoForTag.title : tagName;
		if (infoForTag && infoForTag.color) {
			//Concept pivot
			store.dispatch(navigateToCollectionWithAboutConcept(tagName));
		} else {
			//query pivot
			store.dispatch(navigateToCollectionWithQuery(query.toLowerCase()));
		}
		
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'word-cloud': WordCloud;
	}
}
