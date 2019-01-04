import { LitElement, html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { DialogElement } from './dialog-element.js';

import find from '../reducers/find.js';
store.addReducers({
  find
});

import {
	closeFindDialog
} from '../actions/find.js';

class FindDialog extends connect(store)(DialogElement) {
  innerRender() {
    return html`This is a find dialog!`;
  }

  _shouldClose() {
  	//Override base class.
  	store.dispatch(closeFindDialog());
  }

  stateChanged(state) {
  	this.open = state.find.open;
  }
}

window.customElements.define('find-dialog', FindDialog);
