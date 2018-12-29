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
      <div class='container'>
        This is a comments panel
      </div>
    `;
  }
}

window.customElements.define('comments-panel', CommentsPanel);
