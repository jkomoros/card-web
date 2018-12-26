import { html } from '@polymer/lit-element';
import { PageViewElement } from './page-view-element.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import changes from '../reducers/changes.js';
store.addReducers({
  changes
});

import {
  fetchRecentChanges 
} from '../actions/changes.js';

import {
  navigateToChangesNumDays
} from '../actions/app.js';

// These are the shared styles needed by this element.
import { SharedStyles } from './shared-styles.js';

class RecentChangesView extends connect(store)(PageViewElement) {
  render() {
    return html`
      ${SharedStyles}
      <h2>Recent Changes</h2>
      <p>This is where recent changes will go, I guess.</p>
    `
  }

  extractPageExtra(pageExtra) {
    let parts = pageExtra.split("/");
    if (parts.length < 2) {
      return -1;
    }
    if (parts[1].toLowerCase(0)!="days") {
      return -1;
    }
    return parseInt(parts[0]);
  }

  static get properties() {
    return {
      _numDays: {type: Number},
      _cardsBySection: {type: Object}
    }
  }

  stateChanged(state) {
    this._numDays = this.extractPageExtra(state.app.pageExtra);
    this._cardsBySection = state.changes.cardsBySection;
  }

  updated(changedProps) {
    if(changedProps.has('_numDays')) {
      if (this._numDays < 0) {
        store.dispatch(navigateToChangesNumDays(7));
      } else {
        store.dispatch(fetchRecentChanges(this._numDays));
      }
    }
  }


}

window.customElements.define('recent-changes-view', RecentChangesView);
