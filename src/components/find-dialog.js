import { LitElement, html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { DialogElement } from './dialog-element.js';

class FindDialog extends connect(store)(DialogElement) {
  innerRender() {
    return html`This is a find dialog!`;
  }

  stateChanged(state) {
  	this.open = state.find.open;
  }
}

window.customElements.define('find-dialog', FindDialog);
