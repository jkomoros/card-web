import { html } from '@polymer/lit-element';
import { PageViewElement } from './page-view-element.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { 
	selectUserIsAdmin
} from '../selectors.js';

// These are the shared styles needed by this element.
import { SharedStyles } from './shared-styles.js';

class PermissionsView extends connect(store)(PageViewElement) {
	render() {
		return html`
      ${SharedStyles}
      <section>
        <h2>Permissions</h2>
        <p>This page is where permissions can be changed.</p>
        <section ?hidden=${this._isAdmin}>
          <p>You aren't an admin, so nothing is available here.</p>
        </section>
        <section ?hidden=${!this._isAdmin}>
			<p>This is where functionality will show up when it's implemented</p>
        </section>
      </section>
    `;
	}

	static get properties() {
		return {
			_isAdmin: { type: Boolean},
		};
	}

	stateChanged(state) {
		this._isAdmin = selectUserIsAdmin(state);
	}

}

window.customElements.define('permissions-view', PermissionsView);
