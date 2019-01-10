import { LitElement, html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { DialogElement } from './dialog-element.js';

import {
  selectComposeOpen
} from '../selectors.js';

import {
  composeCancel
} from '../actions/prompt.js';

class ComposeDialog extends connect(store)(DialogElement) {
  innerRender() {
    return html`
      <p>This is a compose dialog!</p>
    `;
  }

  constructor() {
  	super();
  	this.title = 'Compose';
  }

  _shouldClose() {
  	//Override base class.
  	store.dispatch(composeCancel());
  }

  stateChanged(state) {
  	//tODO: it's weird that we manually set our superclasses' public property
  	this.open = selectComposeOpen(state);
  }

}

window.customElements.define('compose-dialog', ComposeDialog);
