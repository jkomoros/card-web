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
  navigateToChangesNumDays,
  urlForCard
} from '../actions/app.js';

// These are the shared styles needed by this element.
import { SharedStyles } from './shared-styles.js';

class RecentChangesView extends connect(store)(PageViewElement) {
  render() {
    return html`
      ${SharedStyles}
      <style>
        :host {
          overflow:scroll;
          height:100%;
          width:100%;
        }
      </style>
      <h2>Recent Changes</h2>
      <div class='container'>
        ${Object.entries(this._sections).map((item) => {
          return html`<div>
          <h3>${item[1].title}</h3>
            ${this._changesForSection(item[0])}
          </div>`
        })}
      <div>
    `
  }

  _changesForSection(sectionName) {
    const items = this._cardsBySection[sectionName];
    if (!items) {
      return html`<em>No changes</em>`;
    }
    return html`<ul>
      ${items.map(item => {
        return html`<li><a card='${item.id}' href='${urlForCard(item.id)}'>${item.title ? item.title : html`<em>Untitled</em>`}</a><em>${this._prettyDate(item.updated_substantive)}</em></li>`
      })}
    <ul>`;
  }

  _prettyDate(timestamp) {
    var d = timestamp.toDate();
    return d.toLocaleString();
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
      _cardsBySection: {type: Object},
      _sections: { type:Object }
    }
  }

  stateChanged(state) {
    this._numDays = this.extractPageExtra(state.app.pageExtra);
    this._cardsBySection = state.changes.cardsBySection;
    this._sections = state.data.sections;
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
