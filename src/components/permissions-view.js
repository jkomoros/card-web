import { html } from '@polymer/lit-element';
import { PageViewElement } from './page-view-element.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

//lazy-load the permissions reducer
import permissions from '../reducers/permissions.js';
store.addReducers({
	permissions,
});

import { 
	selectUserMayEditPermissions
} from '../selectors.js';

import {
	connectLivePermissions
} from '../actions/permissions.js';

// These are the shared styles needed by this element.
import { SharedStyles } from './shared-styles.js';

class PermissionsView extends connect(store)(PageViewElement) {
	render() {
		return html`
      ${SharedStyles}
      <section>
        <h2>Permissions</h2>
        <p>This page is where permissions can be changed.</p>
        <section ?hidden=${this._userMayEditPermissions}>
          <p>You aren't allowed to edit permissions, so nothing is available here.</p>
        </section>
        <section ?hidden=${!this._userMayEditPermissions}>
			<p>This is where functionality will show up when it's implemented</p>
        </section>
      </section>
    `;
	}

	static get properties() {
		return {
			_userMayEditPermissions: { type: Boolean},
		};
	}

	stateChanged(state) {
		this._userMayEditPermissions = selectUserMayEditPermissions(state);
	}

	updated(changedProps) {
		if (changedProps.has('_userMayEditPermissions')) {
			if (this._userMayEditPermissions) {
				connectLivePermissions();
			}
		}
	}

}

window.customElements.define('permissions-view', PermissionsView);
