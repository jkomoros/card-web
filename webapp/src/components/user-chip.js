
import { LitElement, html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

class UserChip extends connect(store)(LitElement) {
  render() {
    return html`
      :-D
    `;
  }

}

window.customElements.define('user-chip', UserChip);
