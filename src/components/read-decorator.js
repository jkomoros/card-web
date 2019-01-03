import { LitElement, html } from '@polymer/lit-element';

import {
  visibilityIcon,
} from './my-icons.js';

import { SharedStyles } from './shared-styles.js';

import { CardDecorator } from './card-decorator.js';

class ReadDecorator extends CardDecorator {
  innerRender() {
    return html`${visibilityIcon}`;
  }
}

window.customElements.define('read-decorator', ReadDecorator);
