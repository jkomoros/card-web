import { html } from '@polymer/lit-element';

import {BaseCard} from './base-card.js';

import './card-link.js';

import {
	TEXT_FIELD_BODY,
	TEXT_FIELD_TITLE,
} from '../card_fields.js';

// This element is *not* connected to the Redux store.
export class ConceptCard extends BaseCard {
	innerRender() {
		return html`
      ${this._templateForField(TEXT_FIELD_TITLE)}
      ${this._templateForField(TEXT_FIELD_BODY)}
    `;
	}
}

window.customElements.define('concept-card', ConceptCard);
