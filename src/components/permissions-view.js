import { html, css } from 'lit';
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
	selectUserMayEditPermissions,
	selectUidsWithPermissions,
	selectUserPermissionsLoaded
} from '../selectors.js';

import {
	connectLivePermissions,
	addPermissionsObjectForUser
} from '../actions/permissions.js';

import {
	PLUS_ICON
} from './my-icons.js';

import {
	COMPOSED_USER_TYPE_ALL_PERMISSIONS,
	COMPOSED_USER_TYPE_ANOYMOUS_PERMISSIONS,
	COMPOSED_USER_TYPE_SIGNED_IN_PERMISSIONS,
	COMPOSED_USER_TYPE_SIGNED_IN_DOMAIN_PERMISSIONS
} from '../permissions.js';

import {
	legalUid
} from '../util.js';

// These are the shared styles needed by this element.
import { SharedStyles } from './shared-styles.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import './permissions-editor.js';

class PermissionsView extends connect(store)(PageViewElement) {

	static styles = [
		ButtonSharedStyles,
		SharedStyles,
		css`
			:host {
				height: 100%;
				overflow: scroll; 
			}

			section {
				margin: 1em;
			}
		`
	];

	render() {
		return html`
      <section>
        <h2>Permissions</h2>
        <p>This page is where permissions can be changed.</p>
        <div ?hidden=${this._userMayEditPermissions}>
		  <p ?hidden=${this._permissionsLoaded}><strong>Loading...</strong></p>
          <p ?hidden=${!this._permissionsLoaded}>You aren't allowed to edit permissions, so nothing is available here.</p>
        </div>
		<div ?hidden=${!this._userMayEditPermissions}>
			<permissions-editor .title=${'All Users Permissions'} .permissions=${COMPOSED_USER_TYPE_ALL_PERMISSIONS} .description=${'Change these in your config.SECRET.json'}></permissions-editor>
			<permissions-editor .title=${'Anonymous Users Permissions'} .permissions=${COMPOSED_USER_TYPE_ANOYMOUS_PERMISSIONS} .description=${'Change these in your config.SECRET.json'}></permissions-editor>
			<permissions-editor .title=${'Signed In Users Permissions'} .permissions=${COMPOSED_USER_TYPE_SIGNED_IN_PERMISSIONS} .description=${'Change these in your config.SECRET.json'}></permissions-editor>
			<permissions-editor .title=${'Signed In Domain Users Permissions'} .permissions=${COMPOSED_USER_TYPE_SIGNED_IN_DOMAIN_PERMISSIONS} .description=${'Change these in your config.SECRET.json'}></permissions-editor>
			${Object.keys(this._uidsWithPermissions || {}).map(uid => html`<permissions-editor .uid=${uid}></permissions-editor>`)}
			<button class='round' @click='${this._handleAdd}'>${PLUS_ICON}</button>
        </div>
      </section>
    `;
	}

	static get properties() {
		return {
			_userMayEditPermissions: { type: Boolean},
			_uidsWithPermissions: { type: Object },
			_permissionsLoaded: { type: Boolean },
		};
	}

	stateChanged(state) {
		this._userMayEditPermissions = selectUserMayEditPermissions(state);
		this._uidsWithPermissions = selectUidsWithPermissions(state);
		this._permissionsLoaded = selectUserPermissionsLoaded(state);
	}

	updated(changedProps) {
		if (changedProps.has('_userMayEditPermissions')) {
			if (this._userMayEditPermissions) {
				connectLivePermissions();
			}
		}
	}

	_handleAdd() {
		const uid = prompt('What is the uid of the user you\'d like to add permissions for? You can look it up in the firebase console.');
		if (!uid) return;
		if (!legalUid(uid)) {
			alert(uid + ' does not appear to be a legal uid.');
			return;
		}
		store.dispatch(addPermissionsObjectForUser(uid));
	}

}

window.customElements.define('permissions-view', PermissionsView);
