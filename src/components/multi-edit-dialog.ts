import {
	blockedReason,
	SAVE_VERB
} from '../sync-copy.js';

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
	addReference,
	commitMultiEditDialog,
	addTag,
	removeTag,
	addTODOEnablement,
	addTODODisablement,
	removeTODOEnablement,
	removeTODODisablement,
	setPublished
} from '../actions/multiedit.js';

import {
	selectCardToReference
} from '../actions/editor.js';

import {
	createTag,
	retryPendingBulkTagOperation,
	abandonPendingBulkTagOperation,
} from '../actions/data.js';

import {
	CHECK_CIRCLE_OUTLINE_ICON
} from '../../shared/icons.js';

import {
	selectMultiEditDialogOpen,
	selectSelectedCardsReferencesUnion,
	selectTagInfosForCards,
	selectMultiEditReferencesDiff,
	selectSelectedCards,
	selectSelectedCardsMissingCount,
	selectCardModificationPending,
	selectBulkTagOperationProgress,
	selectCardModificationError,
	selectSelectedCardsReferencesIntersection,
	selectMultiEditAddTags,
	selectMultiEditRemoveTags,
	selectMultiEditCardDiff,
	selectSelectedCardsTagsUnion,
	selectSelectedCardsTagsIntersection,
	selectTags,
	selectMultiEditAddTODOEnablements,
	selectMultiEditAddTODODisablements,
	selectMultiEditPublished,
	selectCardSavesEligible,
	selectCorpusStatus,
} from '../selectors.js';

import {
	REFERENCE_TYPES,
} from '../../shared/card_fields.js';

import {
	referencesNonModifying,
} from '../references.js';

import {
	help,
	HelpStyles,
} from './help-badges.js';

import {
	arrayDiffAsSets, arrayUnique
} from '../util.js';


import './card-link.js';

import {
	AutoTODOType,
	BooleanDiffValue,
	Card,
	CardDiff,
	CardLike,
	ReferencesEntriesDiff,
	ReferenceType,
	referenceTypeSchema,
	State,
	CorpusStatus,
	TagID,
	TagInfos,
	BulkTagOperationProgress,
} from '../types.js';

import {
	TagEvent
} from '../events.js';

import {
	TypedObject
} from '../../shared/typed_object.js';

import {
	descriptionForCardDiff
} from '../card_diff.js';

import {
	TODO_AUTO_INFOS
} from '../filters.js';

@customElement('multi-edit-dialog')
class MultiEditDialog extends connect(store)(DialogElement) {
	@state()
		_unionReferencesCard: CardLike;

	@state()
		_saveEligible: boolean;

	//Selected cards this tab does not hold yet. A bulk import selects its cards
	//as soon as they are written, so opening this dialog immediately afterwards
	//is a normal way to land here; the corpus usually catches up within a couple
	//of seconds.
	@state()
		_missingSelectedCount: number;

	@state()
		_corpusStatus: CorpusStatus;

	@state()
		_intersectionReferencesCard: CardLike;

	@state()
		_cardTagInfos: TagInfos;

	@state()
		_tagInfos : TagInfos;

	@state()
		_referencesDiff: ReferencesEntriesDiff;
	
	@state()
		_addTags: TagID[];

	@state()
		_removeTags: TagID[];

	@state()
		_unionTags : TagID[];

	@state()
		_intersectionTags : TagID[];

	@state()
		_todoEnablements : AutoTODOType[];

	@state()
		_todoDisablements : AutoTODOType[];

	@state()
		_published : BooleanDiffValue;

	@state()
		_diff : CardDiff;

	@state()
		_selectedCards: Card[];

	@state()
		_cardModificationPending: boolean;

	@state()
		_bulkTagProgress: BulkTagOperationProgress | null;

	@state()
		_cardModificationError: Error | null;

	@state()
		_offline: boolean;

	static override styles = [
		...DialogElement.styles,
		ButtonSharedStyles,
		HelpStyles,
		css`
			/* Hover target for a disabled control's explanation. The
			   vertical-align matches what ButtonSharedStyles puts on the
			   button itself, so wrapping does not drop it below its
			   unwrapped neighbours. */
			span.reason {
				display: inline-flex;
				vertical-align: middle;
			}

			.scrim {
				z-index:100;
				height:100%;
				width:100%;
				position:absolute;
				background-color:rgba(255,255,255,0.7);
				display:none;
			}

			.modification-pending .scrim {
				display:flex;
				align-items:center;
				justify-content:center;
				font-weight:bold;
				text-align:center;
				padding:1em;
				box-sizing:border-box;
			}

			.buttons {
				display:flex;
				flex-direction: row;
				justify-content:flex-end;
			}

			p.waiting {
				color: var(--app-warning-color);
				font-size: 0.85em;
				margin: 0.5em 0 0 0;
			}
		`
	];

	override innerRender() {

		if (!this.open) return html``;
		if (this._bulkTagProgress && this._cardModificationError) return html`
			<div class='bulk-error recovery' role='alert'>
				<h3>Saved multi-edit needs attention</h3>
				<p>${this._cardModificationError.message}</p>
				<progress aria-label='Multi-edit progress' max=${this._bulkTagProgress.total} value=${this._bulkTagProgress.completed}></progress>
				<button @click=${this._handleRetryBulkTag}>Retry remaining ${this._bulkTagProgress.total - this._bulkTagProgress.completed} cards</button>
				<button @click=${this._handleAbandonBulkTag}>Stop and leave partial result</button>
			</div>`;

		const refs = referencesNonModifying(this._unionReferencesCard);
		refs.applyEntriesDiff(this._referencesDiff);
		const referencesMap = refs.byTypeArray();
		const intersectionRefs = referencesNonModifying(this._intersectionReferencesCard);
		intersectionRefs.applyEntriesDiff(this._referencesDiff);
		const intersectionReferencesMap = intersectionRefs.byTypeArray();
		const previousReferencesMap = referencesNonModifying(this._unionReferencesCard).byTypeArray();

		const allTags = arrayUnique([...this._unionTags, ...this._addTags, ...this._removeTags]);
		const unionTags = arrayUnique([...this._unionTags, ...this._addTags]).filter(tag => !this._removeTags.includes(tag));
		const intersectionTags = arrayUnique([...this._intersectionTags, ...this._addTags]);
		const subtleTags = arrayDiffAsSets(unionTags, intersectionTags)[1];

		//Because TODOs are a weird tri-state, we won't even try to show a intersection/union kind of thing.
		//And also, yes, the naming of the items feels backwards, see #689.

		return html`
		<div class='${this._cardModificationPending ? 'modification-pending' : ''}'>
				<div class='scrim' role='status' aria-live='polite' aria-busy=${this._cardModificationPending}>
					${this._offline
		? 'Waiting for a connection to save. The target list is saved in this browser and will resume here.'
		: this._bulkTagProgress
			? html`<span>${this._bulkTagProgress.description}: ${this._bulkTagProgress.completed} of ${this._bulkTagProgress.total} ${this._bulkTagProgress.serverConfirmed ? 'server-confirmed' : 'processed safely'}…
								<progress aria-label='Multi-edit progress' max=${this._bulkTagProgress.total} value=${this._bulkTagProgress.completed}></progress>
								<small>Keep this tab visible to finish faster; progress is safely saved if it is backgrounded.</small></span>`
			: 'Saving selected cards…'}
				</div>
			<div class='edit-form' ?inert=${this._cardModificationPending} aria-hidden=${this._cardModificationPending ? 'true' : 'false'}>
			<select @change=${this._handleAddReference}>
				<option value=''><em>Add a reference to a card type...</option>
				${Object.entries(REFERENCE_TYPES).filter(entry => entry[1].editable).map(entry => html`<option value=${entry[0]}>${entry[1].name}</option>`)}
			</select>
			${TypedObject.entries(REFERENCE_TYPES).filter(entry => (referencesMap[entry[0]] || previousReferencesMap[entry[0]]) && entry[1].editable).map(entry => {
		const subtleItems = arrayDiffAsSets(referencesMap[entry[0]], intersectionReferencesMap[entry[0]])[1];
		return html`<div>
								<label>${entry[1].name} ${help(entry[1].description, false)}</label>
								<tag-list
									.overrideTypeName=${'Reference'}
									data-reference-type=${entry[0]}
									.tagInfos=${this._cardTagInfos}
									.subtleTags=${subtleItems}
									.defaultColor=${entry[1].color}
									.tags=${referencesMap[entry[0]] || []}
									.previousTags=${previousReferencesMap[entry[0]] || []}
									.editing=${true}
									.tapEvents=${true}
									.disableAdd=${true}
									@tag-tapped=${this._handleReferenceTagTapped}
									@tag-added=${this._handleUnremoveReference}
									@tag-removed=${this._handleRemoveReference}>
								</tag-list>
							</div>`;
	})}
			<label>Tags</label>
			<tag-list
				.tags=${unionTags}
				.previousTags=${allTags}
				.subtleTags=${subtleTags}
				.tagInfos=${this._tagInfos}
				.editing=${true}
				.tapEvents=${true}
				@tag-tapped=${this._handleTagTagTapped}
				@tag-added=${this._handleUnremoveTag}
				@tag-removed=${this._handleRemoveTag}
				@tag-new=${this._handleNewTag}>
			>
			</tag-list>
			<label>Enable TODOs</label>
			<tag-list
				.tags=${this._todoDisablements}
				.editing=${true}
				.tapEvents=${true}
				.tagInfos=${TODO_AUTO_INFOS}
				.overrideTypeName=${'Enabled'}
				@tag-added=${this._handleAddTODODisablement}
				@tag-removed=${this._handleRemoveTODODisablement}>
			></tag-list>
			<label>Disable TODOs</label>
			<tag-list
				.tags=${this._todoEnablements}
				.editing=${true}
				.tapEvents=${true}
				.tagInfos=${TODO_AUTO_INFOS}
				.overrideTypeName=${'Disabled'}
				@tag-added=${this._handleAddTODOEnablement}
				@tag-removed=${this._handleRemoveTODOEnablement}>
			></tag-list>
			<label>Published</label>
			<div>
				<select @change=${this._handlePublishedChanged} .value=${String(this._published)}>
					<option value='null' .selected=${this._published === null}>No change</option>
					<option value='true' .selected=${this._published === true}>Published</option>
					<option value='false' .selected=${this._published === false}>Unpublished</option>
				</select>
			</div>
			${Object.values(this._diff).length ? html`<h4>Changes that will be made to selected cards</h4>` : ''}
			<ul class='readout'>
				${descriptionForCardDiff(this._diff, this._cardTagInfos).map(item => html`<li>${item}</li>`)}
			</ul>
			<details>
				<summary><strong>${this._selectedCards.length}</strong> cards selected</summary>
				<ul>
					${this._selectedCards.map(card => html`<li><card-link auto='title' card='${card.id}' .noNavigate=${true}></card-link></li>`)}
				</ul>
			</details>
			<!-- Only when saving is otherwise possible. If sync is down, THAT is
			the blocker and it is the one the user needs to hear about; saying
			"waiting for cards to load" would send them to wait for something
			that is not coming. -->
			${this._missingSelectedCount && this._saveEligible ? html`<p class='waiting' role='status' aria-live='polite'>
				${this._missingSelectedCount === 1
		? html`One of the ${this._selectedCards.length + 1} selected cards has not loaded yet.
						Saving now would quietly skip it, so Save is held until it arrives.`
		: html`${this._missingSelectedCount} of the
						${this._selectedCards.length + this._missingSelectedCount} selected cards have not loaded yet.
						Saving now would quietly skip them, so Save is held until they arrive.`}
			</p>` : ''}
			<div class='buttons'>
				<!-- Title on the wrapper: disabled controls do not fire hover
				events in Chrome/Safari, so a title on the button is invisible
				in precisely the disabled state it explains. The corpus-status
				reason comes FIRST: when sync is down the missing cards are a
				symptom, not the cause, and naming the symptom hides the cause. -->
				<span class='reason' title=${!this._saveEligible ? blockedReason(this._corpusStatus, SAVE_VERB) : this._missingSelectedCount ? `${this._missingSelectedCount} selected ${this._missingSelectedCount === 1 ? 'card has' : 'cards have'} not loaded yet` : 'Save changes'}>
					<button class='round' aria-label='Save changes' ?disabled=${!this._saveEligible || Boolean(this._missingSelectedCount)} @click='${this._handleDoneClicked}'>${CHECK_CIRCLE_OUTLINE_ICON}</button>
				</span>
			</div>
			</div>
		</div>`;
	}

	constructor() {
		super();
		this.title = 'Edit Multiple Cards';
	}

	_handleDoneClicked() {
		store.dispatch(commitMultiEditDialog());
	}

	_handleRetryBulkTag() {
		store.dispatch(retryPendingBulkTagOperation());
	}

	_handleAbandonBulkTag() {
		store.dispatch(abandonPendingBulkTagOperation());
	}

	override _shouldClose(cancelled? : boolean) {
		//Override base class. A RUNNING operation still blocks closing, but a
		//merely-persisted progress record must not: a failed SINGLE-card save
		//sets bulkTagOperationProgress too, so opening Edit All Cards showed
		//"Saved multi-edit needs attention / Retry remaining 1 cards" for an
		//operation the user never started — and both Escape and the X silently
		//did nothing, with the panel's own two buttons the only way out.
		if (this._cardModificationPending) return;
		if (this._bulkTagProgress && !cancelled) return;
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

	_handleReferenceTagTapped(e : TagEvent) {
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

	_handlePublishedChanged(e : Event) {
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLSelectElement)) throw new Error('not select element');
		const value = ele.value;
		if (value === 'null') {
			store.dispatch(setPublished(null));
		} else {
			store.dispatch(setPublished(value === 'true'));
		}
	}

	_handleTagTagTapped(e : TagEvent) {
		//Only add it if not all cards already have it
		if (!e.detail.subtle) return;
		store.dispatch(addTag(e.detail.tag));
	}

	_handleUnremoveTag(e : TagEvent) {
		store.dispatch(addTag(e.detail.tag));
	}

	_handleRemoveTag(e : TagEvent) {
		store.dispatch(removeTag(e.detail.tag));
	}

	_handleNewTag() {
		const name = prompt('What is the base name of the tag?');
		if (!name) return;
		const displayName = prompt('What is the display name for the tag?', name);
		if (!displayName) return;
		store.dispatch(createTag(name, displayName));
	}

	_handleAddTODOEnablement(e : TagEvent) {
		store.dispatch(addTODOEnablement(e.detail.tag as AutoTODOType));
	}

	_handleRemoveTODOEnablement(e : TagEvent) {
		store.dispatch(removeTODOEnablement(e.detail.tag as AutoTODOType));
	}

	_handleAddTODODisablement(e : TagEvent) {
		store.dispatch(addTODODisablement(e.detail.tag as AutoTODOType));
	}

	_handleRemoveTODODisablement(e : TagEvent) {
		store.dispatch(removeTODODisablement(e.detail.tag as AutoTODOType));
	}


	override stateChanged(state : State) {
		this._saveEligible = selectCardSavesEligible(state);
		this._corpusStatus = selectCorpusStatus(state);
		//tODO: it's weird that we manually set our superclasses' public property
		this.open = selectMultiEditDialogOpen(state);
		//selectSelectedCardsReferencesUnion is expensive, only do it if we're open.
		this._unionReferencesCard = this.open ? selectSelectedCardsReferencesUnion(state) : {};
		this._intersectionReferencesCard = this.open ? selectSelectedCardsReferencesIntersection(state) : {};
		this._cardTagInfos = selectTagInfosForCards(state);
		this._tagInfos = selectTags(state);
		this._referencesDiff = selectMultiEditReferencesDiff(state);
		this._addTags = selectMultiEditAddTags(state);
		this._removeTags = selectMultiEditRemoveTags(state);
		this._unionTags = this.open ? selectSelectedCardsTagsUnion(state) : [];
		this._intersectionTags = this.open ? selectSelectedCardsTagsIntersection(state) : [];
		this._todoEnablements = selectMultiEditAddTODOEnablements(state);
		this._todoDisablements = selectMultiEditAddTODODisablements(state);
		this._published = selectMultiEditPublished(state);
		this._selectedCards = selectSelectedCards(state);
		this._missingSelectedCount = selectSelectedCardsMissingCount(state);
		this._cardModificationPending = selectCardModificationPending(state);
		this._bulkTagProgress = selectBulkTagOperationProgress(state);
		this._cardModificationError = selectCardModificationError(state);
		this._offline = state.app.offline;
		this._diff = selectMultiEditCardDiff(state);
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'multi-edit-dialog': MultiEditDialog;
	}
}
