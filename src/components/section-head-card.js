import { html } from '@polymer/lit-element';

import {
	TEXT_FIELD_TITLE,
	TEXT_FIELD_SUBTITLE,
} from '../card_fields.js';

import {BaseCard} from './base-card.js';

// This element is *not* connected to the Redux store.
class SectionHeadCard extends BaseCard {
	innerRender() {
		return html`
      ${this._templateForField(TEXT_FIELD_TITLE)}
      ${this._templateForField(TEXT_FIELD_SUBTITLE)}
    `;
	}
}

window.customElements.define('section-head-card', SectionHeadCard);
