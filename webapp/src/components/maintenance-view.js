import { html } from '@polymer/lit-element';
import { PageViewElement } from './page-view-element.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { userIsAdmin } from '../reducers/user.js';

import {
  doImport,
  addCardTypeToImportedCards
} from '../actions/maintenance.js';

// These are the shared styles needed by this element.
import { SharedStyles } from './shared-styles.js';

class MaintenanceView extends connect(store)(PageViewElement) {
  render() {
    return html`
      ${SharedStyles}
      <section>
        <h2>Maintenance</h2>
        <p>This page is where maintenance can be done.</p>
        <section ?hidden=${this._isAdmin}>
          <p>You aren't an admin, so nothing is available here.</p>
        </section>
        <section ?hidden=${!this._isAdmin}>
          <p>You're an admin!</p>
          <button @click='${this._handleDoImport}'>Do import</button><br />
          <button @click='${this._handleAddCardTypeToImportedCards}'>Add card_type to imported cards</button>
        </section>
      </section>
    `
  }

  static get properties() {
    return {
      _isAdmin: { type: Boolean},
    }
  }

  stateChanged(state) {
    this._isAdmin = userIsAdmin(state);
  }

  _handleDoImport(e) {
    doImport();
  }

  _handleAddCardTypeToImportedCards(e) {
    addCardTypeToImportedCards();
  }

}

window.customElements.define('maintenance-view', MaintenanceView);
