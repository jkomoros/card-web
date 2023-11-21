import { LitElement, html, css, TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	selectActiveCard,
	selectSuggestionsEffectiveSelectedIndex,
	selectSuggestionsForActiveCard,
	selectSuggestionsOpen,
	selectTagInfosForCards
} from '../selectors.js';

import suggestions from '../reducers/suggestions.js';
store.addReducers({
	suggestions
});

import {
	HelpStyles,
} from './help-badges.js';

import {
	Card,
	CardDiff,
	State,
	Suggestion,
	TagInfos
} from '../types.js';

import {
	CANCEL_ICON,
	CHECK_CIRCLE_OUTLINE_ICON
} from './my-icons.js';

import {
	applySuggestion,
	suggestionsChangeSelected,
	suggestionsHidePanel
} from '../actions/suggestions.js';

import {
	TagEvent
} from '../events.js';

import './suggestions-summary.js';
import './tag-list.js';
import { descriptionForCardDiff } from '../card_diff.js';

@customElement('suggestions-viewer')
class SuggestionsViewer extends connect(store)(LitElement) {

	@state()
		_card: Card | null;

	@state()
		_active: boolean;

	@state()
		_suggestions : Suggestion[];

	@state()
		_selectedIndex: number;

	@state()
		_tagInfosForCards : TagInfos;

	static override styles = [
		ButtonSharedStyles,
		HelpStyles,
		css`
			:host {
				position:relative;
				background-color: white;
			}

			.container {
				width: 100%;
				height:100%;
				display:flex;
				flex-direction: column;
				/* The up-down padding comes from margins in the top and bottom elements */
				padding: 0 0.5em;
				box-sizing:border-box;
			}

			.buttons {
				display:flex;
				flex-direction:row;
				width:100%;
			}

			.row {
				display: flex;
				flex-direction: row;
				width: 100%;
			}

			.row.distributed {
				justify-content: space-evenly;
			}

			.row > div {
				display: flex;
				flex-direction: column;
			}

			.container.not-minimized {
				position:absolute;
			}

			.flex {
				flex-grow:1;
			}

			[hidden] {
				display:none;
			}

			table {
				width: 100%;
			}

			ul {
				margin: 0;
			}

		`
	];

	get _selectedSuggestion() : Suggestion {
		//The index is known to fit within our suggestions because of selectSuggestionsEffectiveSelectedIndex
		return this._suggestions[this._selectedIndex];
	}

	descriptionForDiff(diff? : CardDiff) : TemplateResult {
		if (!diff) return html`<ul>
			<li>
				<em>No changes</em>
			</li>
		</ul>`;

		return html`<ul>
			${descriptionForCardDiff(diff).map(line => html`<li>${line}</li>`)}
		</ul>`;
	}

	override render() {

		if (!this._active) return '';

		const card = this._card;

		const suggestion = this._selectedSuggestion;

		if (!card) return html`No card`;
		return html`<div class='container'>
			<div class='row'>
				<div class='flex'></div>
				<suggestions-summary
					.suggestions=${this._suggestions}
					.selectedIndex=${this._selectedIndex}
					@tag-tapped=${this._handleSuggestionTapped}
				>
				</suggestions-summary>
				<div class='flex'></div>
				<button
					class='small'
					@click=${this._handleCloseClicked}
					title='Close'
				>
					${CANCEL_ICON}
				</button>
			</div>
			<table>
				<tr>
					<td>
						<label>Key Cards</label>
						<tag-list
							.tags=${suggestion.keyCards}
							.tagInfos=${this._tagInfosForCards}
							.tapEvents=${true}
						></tag-list>
					</td>
					<td>
						<label>Supporting Cards</label>
						<tag-list
							.tags=${suggestion.supportingCards}
							.tagInfos=${this._tagInfosForCards}
							.tapEvents=${true}
						></tag-list>
					</td>
					<td>
						<label>Type</label>
						<span>${suggestion.type}</span>
					</td>
				</tr>
				<tr>
					<td>
						${this.descriptionForDiff(suggestion.action.keyCard)}
					</td>
					<td>
						${this.descriptionForDiff(suggestion.action.supportingCards)}
					</td>
					<td>
						<button
							class='round primary'
							title='Accept Primary Action'
							@click=${this._handleAcceptPrimaryActionClicked}
						>
							${CHECK_CIRCLE_OUTLINE_ICON}
						</button>
					</td>
				</tr>
				<tr>
					<td>
						${this.descriptionForDiff(suggestion.alternateAction?.keyCard)}
					</td>
					<td>
						${this.descriptionForDiff(suggestion.alternateAction?.supportingCards)}
					</td>
					<td>
						${suggestion.alternateAction ? 
		html`<button
								class='round'
								title='Accept Alternate Action'
								@click=${this._handleAcceptAlternateActionClicked}
								>
									${CHECK_CIRCLE_OUTLINE_ICON}
								</button>` :
		''
}
					</td>
				</tr>
			</table>
		</div>`;
	}

	override stateChanged(state : State) {
		this._card= selectActiveCard(state);
		this._active = selectSuggestionsOpen(state);
		this._suggestions = selectSuggestionsForActiveCard(state);
		this._selectedIndex = selectSuggestionsEffectiveSelectedIndex(state);
		this._tagInfosForCards = selectTagInfosForCards(state);
	}

	_handleSuggestionTapped(e : TagEvent) {
		store.dispatch(suggestionsChangeSelected(e.detail.tag));
	}

	_handleCloseClicked() {
		store.dispatch(suggestionsHidePanel());
	}

	_handleAcceptAlternateActionClicked() {
		store.dispatch(applySuggestion(this._selectedSuggestion, 'alternate'));
	}

	_handleAcceptPrimaryActionClicked() {
		store.dispatch(applySuggestion(this._selectedSuggestion, 'primary'));
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'suggestions-viewer': SuggestionsViewer;
	}
}