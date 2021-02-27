import { html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { DialogElement } from './dialog-element.js';

import multiedit from '../reducers/multiedit.js';
store.addReducers({
	multiedit
});

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	closeMultiEditDialog,
	removeReference
} from '../actions/multiedit.js';

import {
	CHECK_CIRCLE_OUTLINE_ICON
} from './my-icons.js';

import {
	selectMultiEditDialogOpen,
	selectSelectedCardsReferencesUnion,
	selectTagInfosForCards,
	selectMultiEditReferencesDiff,
	selectSelectedCards
} from '../selectors.js';

import {
	REFERENCE_TYPES,
} from '../card_fields.js';

import {
	referencesNonModifying,
} from '../references.js';

import {
	help,
	HelpStyles,
} from './help-badges.js';

class MultiEditDialog extends connect(store)(DialogElement) {
	innerRender() {

		const refs = referencesNonModifying(this._unionReferencesCard);
		refs.applyEntriesDiff(this._referencesDiff);
		const referencesMap = refs.byTypeArray();

		return html`
		${HelpStyles}
		${ButtonSharedStyles}
		<style>
			.buttons {
				display:flex;
				flex-direction: row;
				justify-content:flex-end;
			}
		</style>
		<div>
		${Object.entries(REFERENCE_TYPES).filter(entry => referencesMap[entry[0]]).map(entry => {
		return html`<div>
							<label>${entry[1].name} ${help(entry[1].description, false)}</label>
							<tag-list .overrideTypeName=${'Reference'} .referenceType=${entry[0]} .tagInfos=${this._cardTagInfos} .defaultColor=${entry[1].color} .tags=${referencesMap[entry[0]]} .editing=${entry[1].editable} .subtle=${!entry[1].editable} .tapEvents=${true} .disableAdd=${true} @remove-tag=${this._handleRemoveReference}></tag-list>
						</div>`;
	})}
		<div class='buttons'>
			<button class='round' @click='${this._handleDoneClicked}'>${CHECK_CIRCLE_OUTLINE_ICON}</button>
		</div>
	</div>`;
	}

	constructor() {
		super();
		this.title = 'Edit Multiple Cards';
	}

	_handleDoneClicked() {
		this._shouldClose();
	}

	_shouldClose() {
		//Override base class.
		store.dispatch(closeMultiEditDialog());
	}

	_handleRemoveReference(e) {
		let referenceType = '';
		//Walk up the chain to find which tag-list has it (which will have the
		//referenceType we set explicitly on it)
		for (let ele of e.composedPath()) {
			if (ele.referenceType) {
				referenceType = ele.referenceType;
				break;
			}
		}
		if (!referenceType) {
			console.warn('No reference type found on parents');
		}
		store.dispatch(removeReference(e.detail.tag, referenceType));
	}

	static get properties() {
		return {
			_unionReferencesCard: {type: Object},
			_cardTagInfos: {type: Object},
			_referencesDiff: {type:Array},
			_selectedCards: {type:Array},
		};
	}

	stateChanged(state) {
		//tODO: it's weird that we manually set our superclasses' public property
		this.open = selectMultiEditDialogOpen(state);
		//selectSelectedCardsReferencesUnion is expensive, only do it if we're open.
		this._unionReferencesCard = this.open ? selectSelectedCardsReferencesUnion(state) : {};
		this._cardTagInfos = selectTagInfosForCards(state);
		this._referencesDiff = selectMultiEditReferencesDiff(state);
		this._selectedCards = selectSelectedCards(state);
	}

}

window.customElements.define('multi-edit-dialog', MultiEditDialog);
