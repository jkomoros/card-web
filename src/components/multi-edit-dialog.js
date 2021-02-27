import { html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { DialogElement } from './dialog-element.js';

import multiedit from '../reducers/multiedit.js';
store.addReducers({
	multiedit
});

import {
	closeMultiEditDialog,
} from '../actions/multiedit.js';

import {
	selectMultiEditDialogOpen,
	selectSelectedCardsReferencesUnion,
	selectTagInfosForCards
} from '../selectors.js';

import {
	REFERENCE_TYPES,
} from '../card_fields.js';

import {
	references,
} from '../references.js';

import {
	help,
	HelpStyles,
} from './help-badges.js';

class MultiEditDialog extends connect(store)(DialogElement) {
	innerRender() {

		const referencesMap = references(this._unionReferencesCard).byTypeArray();

		return html`
		${HelpStyles}
		<div>
		${Object.entries(REFERENCE_TYPES).filter(entry => referencesMap[entry[0]]).map(entry => {
		return html`<div>
							<label>${entry[1].name} ${help(entry[1].description, false)}</label>
							<tag-list .overrideTypeName=${'Reference'} .referenceType=${entry[0]} .tagInfos=${this._cardTagInfos} .defaultColor=${entry[1].color} .tags=${referencesMap[entry[0]]} .editing=${entry[1].editable} .subtle=${!entry[1].editable} .tapEvents=${true} .disableAdd=${true} @remove-tag=${this._handleRemoveReference}></tag-list>
						</div>`;
	})}
	</div>`;
	}

	constructor() {
		super();
		this.title = 'Edit Multiple Cards';
	}

	_shouldClose() {
		//Override base class.
		store.dispatch(closeMultiEditDialog());
	}

	_handleRemoveReference() {
		alert('Not yet implemented');
	}

	static get properties() {
		return {
			_unionReferencesCard: {type: Object},
			_cardTagInfos: {type: Object},
		};
	}

	stateChanged(state) {
		//tODO: it's weird that we manually set our superclasses' public property
		this.open = selectMultiEditDialogOpen(state);
		//selectSelectedCardsReferencesUnion is expensive, only do it if we're open.
		this._unionReferencesCard = this.open ? selectSelectedCardsReferencesUnion(state) : {};
		this._cardTagInfos = selectTagInfosForCards(state);
	}

}

window.customElements.define('multi-edit-dialog', MultiEditDialog);
