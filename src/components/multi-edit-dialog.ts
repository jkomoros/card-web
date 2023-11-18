import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
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
	removeReference,
	addReference
} from '../actions/multiedit.js';

import {
	modifyCards
} from '../actions/data.js';

import {
	selectCardToReference
} from '../actions/editor.js';

import {
	CHECK_CIRCLE_OUTLINE_ICON
} from './my-icons.js';

import {
	selectMultiEditDialogOpen,
	selectSelectedCardsReferencesUnion,
	selectTagInfosForCards,
	selectMultiEditReferencesDiff,
	selectSelectedCards,
	selectCardModificationPending,
	selectSelectedCardsReferencesIntersection
} from '../selectors.js';

import {
	REFERENCE_TYPES,
} from '../card_fields.js';

import {
	referencesNonModifying,
	isExpandedReferenceDelete
} from '../references.js';

import {
	help,
	HelpStyles,
} from './help-badges.js';

import {
	arrayDiffAsSets
} from '../util.js';


import './card-link.js';

import {
	Card,
	CardLike,
	ReferencesEntriesDiff,
	ReferenceType,
	referenceTypeSchema,
	State,
	TagInfos
} from '../types.js';

import {
	TagEvent
} from '../events.js';

import {
	TypedObject
} from '../typed_object.js';

@customElement('multi-edit-dialog')
class MultiEditDialog extends connect(store)(DialogElement) {

	@state()
		_unionReferencesCard: CardLike;

	@state()
		_intersectionReferencesCard: CardLike;

	@state()
		_cardTagInfos: TagInfos;

	@state()
		_referencesDiff: ReferencesEntriesDiff;

	@state()
		_selectedCards: Card[];

	@state()
		_cardModificationPending: boolean;

	static override styles = [
		...DialogElement.styles,
		ButtonSharedStyles,
		HelpStyles,
		css`
			.scrim {
				z-index:100;
				height:100%;
				width:100%;
				position:absolute;
				background-color:rgba(255,255,255,0.7);
				display:none;
			}

			.modification-pending .scrim {
				display:block;
			}

			.buttons {
				display:flex;
				flex-direction: row;
				justify-content:flex-end;
			}
		`
	];

	override innerRender() {

		if (!this.open) return html``;

		const refs = referencesNonModifying(this._unionReferencesCard);
		refs.applyEntriesDiff(this._referencesDiff);
		const referencesMap = refs.byTypeArray();
		const intersectionRefs = referencesNonModifying(this._intersectionReferencesCard);
		intersectionRefs.applyEntriesDiff(this._referencesDiff);
		const intersectionReferencesMap = intersectionRefs.byTypeArray();
		const previousReferencesMap = referencesNonModifying(this._unionReferencesCard).byTypeArray();

		return html`
		<div class='${this._cardModificationPending ? 'modification-pending' : ''}'>
			<div class='scrim'></div>
			<select @change=${this._handleAddReference}>
				<option value=''><em>Add a reference to a card type...</option>
				${Object.entries(REFERENCE_TYPES).filter(entry => entry[1].editable).map(entry => html`<option value=${entry[0]}>${entry[1].name}</option>`)}
			</select>
			${TypedObject.entries(REFERENCE_TYPES).filter(entry => (referencesMap[entry[0]] || previousReferencesMap[entry[0]]) && entry[1].editable).map(entry => {
		const subtleItems = arrayDiffAsSets(referencesMap[entry[0]], intersectionReferencesMap[entry[0]])[1];
		return html`<div>
								<label>${entry[1].name} ${help(entry[1].description, false)}</label>
								<tag-list .overrideTypeName=${'Reference'} data-reference-type=${entry[0]} .tagInfos=${this._cardTagInfos} .subtleTags=${subtleItems} .defaultColor=${entry[1].color} .tags=${referencesMap[entry[0]] || []} .previousTags=${previousReferencesMap[entry[0]] || []} .editing=${true} .tapEvents=${true} .disableAdd=${true} @tag-tapped=${this._handleTagTapped} @tag-added=${this._handleUnremoveReference} @tag-removed=${this._handleRemoveReference}></tag-list>
							</div>`;
	})}
			${this._referencesDiff.length ? html`<h4>Changes that will be made to selected cards</h4>` : ''}
			<ul class='readout'>
				${this._referencesDiff.map(item => html`<li>${isExpandedReferenceDelete(item) ? 'Remove' : 'Add'} ${item.referenceType} reference to <card-link auto='title' card='${item.cardID}' .noNavigate=${true}></card-link></li>`)}
			</ul>
			<details>
				<summary><strong>${this._selectedCards.length}</strong> cards selected</summary>
				<ul>
					${this._selectedCards.map(card => html`<li><card-link auto='title' card='${card.id}' .noNavigate=${true}></card-link></li>`)}
				</ul>
			</details>
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
		if (this._referencesDiff.length) {
			const update = {
				references_diff: this._referencesDiff,
			};
			store.dispatch(modifyCards(this._selectedCards, update, false, false));
			//We'll close the dialog when modifyCardSuccess is triggered.
			return;
		}
		//If we didn't have anything to do, close it now.
		this._shouldClose();
	}

	override _shouldClose() {
		//Override base class.
		store.dispatch(closeMultiEditDialog());
	}

	_handleAddReference(e : Event) {
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLSelectElement)) throw new Error('not select element');
		if (!ele.value) return;
		const value = ele.value as ReferenceType;
		if (!REFERENCE_TYPES[value]) throw new Error('Unknown reference type');
		//Set it back to default
		ele.value = '';
		store.dispatch(selectCardToReference(value));
	}

	_handleTagTapped(e : TagEvent) {
		//Only add it if not all cards already have it
		if (!e.detail.subtle) return;
		let refType : ReferenceType | undefined = undefined;
		//Walk up the chain to find which tag-list has it (which will have the
		//referenceType we set explicitly on it)
		for (const ele of e.composedPath()) {
			//e.g. documentFragment
			if (!(ele instanceof HTMLElement)) continue;
			if (ele.dataset.referenceType) {
				refType = referenceTypeSchema.parse(ele.dataset.referenceType);
				break;
			}
		}
		if (!refType) {
			console.warn('No reference type found on parents');
			return;
		}
		store.dispatch(addReference(e.detail.tag, refType));
	}

	_handleUnremoveReference(e : TagEvent) {
		let refType : ReferenceType | undefined = undefined;
		//Walk up the chain to find which tag-list has it (which will have the
		//referenceType we set explicitly on it)
		for (const ele of e.composedPath()) {
			//e.g. documentFragment
			if (!(ele instanceof HTMLElement)) continue;
			if (ele.dataset.referenceType) {
				refType = referenceTypeSchema.parse(ele.dataset.referenceType);
				break;
			}
		}
		if (!refType) {
			console.warn('No reference type found on parents');
			return;
		}
		store.dispatch(addReference(e.detail.tag, refType));
	}

	_handleRemoveReference(e : TagEvent) {
		let refType : ReferenceType | undefined = undefined;
		//Walk up the chain to find which tag-list has it (which will have the
		//referenceType we set explicitly on it)
		for (const ele of e.composedPath()) {
			if (!(ele instanceof HTMLElement)) continue;
			if (ele.dataset.referenceType) {
				refType = referenceTypeSchema.parse(ele.dataset.referenceType);
				break;
			}
		}
		if (!refType) {
			console.warn('No reference type found on parents');
			return;
		}
		store.dispatch(removeReference(e.detail.tag, refType));
	}

	override stateChanged(state : State) {
		//tODO: it's weird that we manually set our superclasses' public property
		this.open = selectMultiEditDialogOpen(state);
		//selectSelectedCardsReferencesUnion is expensive, only do it if we're open.
		this._unionReferencesCard = this.open ? selectSelectedCardsReferencesUnion(state) : {};
		this._intersectionReferencesCard = this.open ? selectSelectedCardsReferencesIntersection(state) : {};
		this._cardTagInfos = selectTagInfosForCards(state);
		this._referencesDiff = selectMultiEditReferencesDiff(state);
		this._selectedCards = selectSelectedCards(state);
		this._cardModificationPending = selectCardModificationPending(state);
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'multi-edit-dialog': MultiEditDialog;
	}
}
