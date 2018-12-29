import { LitElement, html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { commentIcon } from './my-icons.js';

import { SharedStyles } from './shared-styles.js';
import { ButtonSharedStyles } from './button-shared-styles.js';

class CommentsPanel extends connect(store)(LitElement) {
  render() {
    return html`
      ${SharedStyles}
      ${ButtonSharedStyles}
      <style>
        .container {
          width: 6em;
          height:100%;
          padding:0.5em;
          border-left: 1px solid var(--app-divider-color);
          position:relative;
        }
        h3 {
          margin:0;
          font-weight:normal;
          color: var(--app-dark-text-color-light);
        }
        button {
          position:absolute;
          bottom:1em;
          right:1em;
        }
      </style>
      <div ?hidden=${!this._open} class='container'>
        <h3>Comments</h3>
        <button class='round' @click='${this._handleCreateThreadClicked}'>${commentIcon}</button>
      </div>
    `;
  }

  static get properties() {
    return {
      _open: {type: Boolean}
    }
  }

  _handleCreateThreadClicked(e) {
    console.warn("Not yet implemented");
  }

  stateChanged(state) {
    this._open = state.app.commentsPanelOpen;
  }
}

window.customElements.define('comments-panel', CommentsPanel);
