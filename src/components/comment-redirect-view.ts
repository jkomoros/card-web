import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { PageViewElement } from './page-view-element.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { 
	navigateToCardInDefaultCollection, 
	navigateToComment
} from '../actions/app.js';

import {
	State
} from '../types.js';

@customElement('comment-redirect-view')
class CommentRedirectView extends connect(store)(PageViewElement) {

	@state()
	_pageExtra: string;

	static override styles = [
		css`
			div {
				padding: 2em;
			}
		`
	];

	override render() {
		return html`
			<div>
				<h3>
					Please wait while we redirect you to that comment...
				</h3>
		</div>
    `;
	}

	override stateChanged(state : State) {
		this._pageExtra = state.app.pageExtra;
	}

	override updated(changedProps) {
		if (changedProps.has('_pageExtra')) {
			if (this._pageExtra) {
				store.dispatch(navigateToComment(this._pageExtra));
			} else {
				//Dispatching to '' will use default;
				store.dispatch(navigateToCardInDefaultCollection(''));
			}
		}
	}
}

declare global {
	interface HTMLElementTagNameMap {
	  'comment-redirect-view': CommentRedirectView;
	}
}
