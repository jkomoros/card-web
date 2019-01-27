
import { LitElement, html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';

import {
	firebase
} from '../actions/database.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

// We are lazy loading its reducer.
import user from '../reducers/user.js';
store.addReducers({
	user
});

import {
	personIcon,
	notificationsNoneIcon,
	notificationsActiveIcon
} from './my-icons.js';

import {
	signIn,
	signInSuccess,
	signOutSuccess,
	signOut,
} from '../actions/user.js';

import {
	selectUser,
	selectUserSignedIn,
	selectNotificationsEnabled,
} from '../selectors.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	messaging,
	notificationsTokenUpdated
} from '../actions/database.js';

class UserChip extends connect(store)(LitElement) {
	render() {
		return html`
      ${ButtonSharedStyles}
      <style>
        div {
          display:flex;
          justify-content:center;
          align-items:center;
        }
        img {
          --user-image-size: 36px;
          height:var(--user-image-size);
          width: var(--user-image-size);
          border-radius:calc(var(--user-image-size) / 2);
          margin: calc(var(--user-image-size) / 4);
          cursor:pointer;
        }
        img:hover {
          opacity:0.5;
          filter: saturate(0%);
        }
        div.pending {
          font-style:italic;
        }
      </style>
      <div class='${this._pending ? 'pending' : ''}'>
        ${this._signedIn
		? html`<span>${this._effectiveUser.displayName}</span><button class='round' @click=${this._handleNotifcationClick}>${this._notificationsEnabled ? notificationsActiveIcon : notificationsNoneIcon}</button><img title='${this._effectiveUser.displayName + ' - ' + this._effectiveUser.email + ' - Click to sign out'}' src='${this._effectiveUser.photoURL}' @click=${this._handleSignOutClick}>`
		: html`<span>Sign in with your Google Account</span><button class='round' @click=${this._handleSignInClick}>${personIcon}</button>`
}
      </div>
      `;
	}

	firstUpdated() {
		firebase.auth().onAuthStateChanged(this._handleAuthStateChanged);
	}

	_handleAuthStateChanged(user) {
		if (user) {
			store.dispatch(signInSuccess(user, store));
		} else {
			store.dispatch(signOutSuccess());
		}
	}

	_handleNotifcationClick() {
		if (!this._notificationsEnabled) {
			messaging.requestPermission().then(() => {
				notificationsTokenUpdated();
			}).catch(err => {
				console.warn('Couldn\'t get permission to notify:', err);
			});
		}
	}

	_handleSignInClick() {
		store.dispatch(signIn());
	}

	_handleSignOutClick() {
		store.dispatch(signOut());
	}

	get _effectiveUser() {
		if (this._user) return this._user;
		return {
			displayName: '',
			email: '',
			photoURL: '',
		};
	}

	static get properties() {
		return {
			_pending: { type: Boolean },
			_user: { type: Object },
			_signedIn: { type: Boolean},
			_error: { type: Object },
			_notificationsEnabled: {type:Boolean},
		};
	}

	stateChanged(state) {
		this._pending = state.user.pending;
		this._user = selectUser(state);
		this._signedIn = selectUserSignedIn(state);
		this._error = state.user.error;
		this._notificationsEnabled = selectNotificationsEnabled(state);
	}


}

window.customElements.define('user-chip', UserChip);
