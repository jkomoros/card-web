import { html } from '@polymer/lit-element';
import { PageViewElement } from './page-view-element.js';

// These are the shared styles needed by this element.
import { SharedStyles } from './shared-styles.js';

class MaintenanceView extends PageViewElement {
  render() {
    return html`
      ${SharedStyles}
      <section>
        <h2>Maintenance</h2>
        <p>This page is where maintenance can be done.</p>
      </section>
    `
  }
}

window.customElements.define('maintenance-view', MaintenanceView);
