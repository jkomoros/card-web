import { LitElement, html } from '@polymer/lit-element';

import { DialogElement } from './dialog-element.js';

class FindDialog extends DialogElement {
  innerRender() {
    return html`This is a find dialog!`;
  }
}

window.customElements.define('find-dialog', FindDialog);
