import { html } from '@polymer/lit-element';
import { PageViewElement } from './page-view-element.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

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


}

window.customElements.define('recent-changes-view', RecentChangesView);
