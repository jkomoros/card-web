
import { LitElement, html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

// We are lazy loading its reducer.
import user from '../reducers/user.js';
store.addReducers({
  user
});

import {
  signIn,
  signOut
} from '../actions/user.js';

class UserChip extends connect(store)(LitElement) {
  render() {
    return html`
      ${this._pending ? '***' : ''}
      ${this._user
        ? html`<span>${this._user.displayName}</span><button @click=${this._handleSignOutClick}>Sign Out</button>`
        : html`<button @click=${this._handleSignInClick}>Sign In</button>`
      }`;
  }

  _handleSignInClick(e) {
    store.dispatch(signIn());
  }

  _handleSignOutClick(e) {
    store.dispatch(signOut());
  }

  static get properties() {
    return {
      _pending: { type: Boolean },
      _user: { type: Object },
      _error: { type: Object }
    }
  }

  stateChanged(state) {
    this._pending = state.user.pending;
    this._user = state.user.user;
    this._error = state.user.error;
  }


}

window.customElements.define('user-chip', UserChip);
