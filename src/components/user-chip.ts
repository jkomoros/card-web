
import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

// We are lazy loading its reducer.
import user from '../reducers/user.js';
store.addReducers({
	user
});

import {
	PERSON_ICON,
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
} from '../selectors.js';

import {
	auth
} from '../firebase.js';

import {
	onAuthStateChanged,
	User
} from 'firebase/auth';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	State, UserInfo
} from '../types.js';

@customElement('user-chip')
class UserChip extends connect(store)(LitElement) {

	@state()
		_pending: boolean;

	@state()
		_user: UserInfo | null;

	@state()
		_signedIn: boolean;

	@state()
		_error: Error | null;

	static override styles = [
		ButtonSharedStyles,
		css`
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
		`
	];

	override render() {
		return html`
			<div class='${this._pending ? 'pending' : ''}'>
				${this._signedIn
		? html`<span>${this._effectiveUser.displayName}</span><img title='${this._effectiveUser.displayName + ' - ' + this._effectiveUser.email + ' - Click to sign out'}' src='${this._effectiveUser.photoURL}' @click=${this._handleSignOutClick}>`
		: html`<span>Sign in with your Google Account</span><button class='round' @click=${this._handleSignInClick}>${PERSON_ICON}</button>`
}
			</div>
	  	`;
	}

	override firstUpdated() {
		onAuthStateChanged(auth, this._handleAuthStateChanged);
	}

	_handleAuthStateChanged(user : User) {
		if (user) {
			store.dispatch(signInSuccess(user));
		} else {
			store.dispatch(signOutSuccess());
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

	override stateChanged(state : State) {
		this._pending = state.user?.pending || false;
		this._user = selectUser(state);
		this._signedIn = selectUserSignedIn(state);
		this._error = state.user?.error || null;
	}


}

declare global {
	interface HTMLElementTagNameMap {
		'user-chip': UserChip;
	}
}
