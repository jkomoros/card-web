import { html } from '@polymer/lit-element';
import { PageViewElement } from './page-view-element.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { 
	navigateToCard, 
	navigateToComment
} from '../actions/app.js';

class CommentRedirectView extends connect(store)(PageViewElement) {
	render() {
		return html`
			<div>
				Please wait while we redirect you to that comment...
      </div>
    `;
	}

	static get properties() {
		return {
			_pageExtra: {type: String},
		};
	}

	stateChanged(state) {
		this._pageExtra = state.app.pageExtra;
	}

	updated(changedProps) {
		if (changedProps.has('_pageExtra')) {
			if (this._pageExtra) {
				store.dispatch(navigateToComment(this._pageExtra));
			} else {
				//Dispatching to '' will use default;
				store.dispatch(navigateToCard(''));
			}
		}
	}
}

window.customElements.define('comment-redirect-view', CommentRedirectView);
