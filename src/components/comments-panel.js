import { LitElement, html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { SharedStyles } from './shared-styles.js';

class CommentsPanel extends connect(store)(LitElement) {
  render() {
    return html`
      ${SharedStyles}
      <style>
        .container {
          max-width: 6em;
        }
      </style>
      <div ?hidden=${!this._open} class='container'>
        This is a comments panel
      </div>
    `;
  }

  static get properties() {
    return {
      _open: {type: Boolean}
    }
  }

  stateChanged(state) {
    this._open = state.app.commentsPanelOpen;
  }
}

window.customElements.define('comments-panel', CommentsPanel);
