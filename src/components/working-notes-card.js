import { html } from '@polymer/lit-element';

import {BaseCard} from './base-card.js';

import './card-link.js';


import {
	TEXT_FIELD_BODY,
} from '../card_fields.js';

// This element is *not* connected to the Redux store.
export class WorkingNotesCard extends BaseCard {
	innerRender() {
		return html`
		<style>
			section {
				font-size:0.8em;
				line-height:1.2;
			}
			/* Google docs pasted output includes <p> inside of li a lot. This
			is a hack, #361 covers fixing it */
			li > p {
				display:inline;
			}
		</style>
      ${this._templateForField(TEXT_FIELD_BODY)}
    `;
	}
}

window.customElements.define('working-notes-card', WorkingNotesCard);
