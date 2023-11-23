import { LitElement, html, css } from 'lit';
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
	selectSuggestionsUseLLMs,
	selectTagInfosForCards,
	selectUserMayUseAI
} from '../selectors.js';

import suggestions from '../reducers/suggestions.js';
store.addReducers({
	suggestions
});

import {
	HelpStyles,
} from './help-badges.js';

import {
	ProcessedCard,
	State,
	Suggestion,
	TagInfos
} from '../types.js';

import {
	COLORS
} from '../type_constants.js';

import {
	CANCEL_ICON,
	CHECK_CIRCLE_OUTLINE_ICON
} from './my-icons.js';

import {
	applySuggestion,
	suggestionsChangeSelected,
	suggestionsHidePanel,
	suggestionsSetUseLLMs
} from '../actions/suggestions.js';

import {
	TagEvent
} from '../events.js';

import {
	descriptionForSuggestion
} from '../card_diff.js';

import {
	NEW_CARD_ID_PLACEHOLDER
} from '../card_fields.js';

import './suggestions-summary.js';
import './tag-list.js';

const KEY_CARD_COLOR = COLORS.DARK_GREEN;
const SUPPORTING_CARD_COLOR = COLORS.NAVY;
const NEW_CARD_COLOR = COLORS.DARK_MAGENTA;

@customElement('suggestions-viewer')
class SuggestionsViewer extends connect(store)(LitElement) {

	@state()
		_card: ProcessedCard | null;

	@state()
		_active: boolean;

	@state()
		_suggestions : Suggestion[];

	@state()
		_selectedIndex: number;

	@state()
		_tagInfosForCards : TagInfos;

	@state()
		_useLLMs : boolean;

	@state()
		_userMayUseAI : boolean;

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

			.suggestion {
				font-size: 0.9em;
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

			button.round {
				margin: 0;
			}

			.empty {
				width: 100%;
				min-height: 6em;
				display: flex;
				justify-content: center;
				align-items: center;
			}

		`
	];

	get _selectedSuggestion() : Suggestion | undefined {
		//The index is known to fit within our suggestions because of selectSuggestionsEffectiveSelectedIndex
		return this._suggestions[this._selectedIndex];
	}

	_modifiedTagInfos(suggestion? : Suggestion) : TagInfos {
		if (!this._tagInfosForCards) return {};
		const result = {...this._tagInfosForCards};
		if (!suggestion) return result;
		for (const card of suggestion.keyCards) {
			result[card] = {
				...result[card],
				color: KEY_CARD_COLOR
			};
		}
		for (const card of suggestion.supportingCards) {
			result[card] = {
				...result[card],
				color: SUPPORTING_CARD_COLOR
			};
		}
		result[NEW_CARD_ID_PLACEHOLDER] = {
			id: NEW_CARD_ID_PLACEHOLDER,
			title: 'New Card',
			color: NEW_CARD_COLOR
		};
		return result;
	}

	override render() {

		if (!this._active) return '';

		const card = this._card;

		const suggestion = this._selectedSuggestion;

		if (!card) return html`No card`;

		const tagInfos = this._modifiedTagInfos(suggestion);

		const diffTemplates = descriptionForSuggestion(suggestion, tagInfos);

		return html`<div class='container'>
			<div class='row'>
				${this._userMayUseAI ? 
		html`<input type='checkbox' id='use-llm' .checked=${this._useLLMs} @change=${this._handleUseLLMsChanged}></input>
		<label for='use-llm'>Enable LLM Suggestions</label>` :
		''}
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
			${diffTemplates.primary ? 
		html`
			<div class='row suggestion'>
				<div class='suggestion-text'>
					${diffTemplates.primary}
				</div>
				<div class='flex'></div>
				<div>
					<button
								class='round primary'
								title='Accept Primary Action'
								@click=${this._handleAcceptPrimaryActionClicked}
							>
								${CHECK_CIRCLE_OUTLINE_ICON}
							</button>
				</div>
			</div>
			` : 
		html`<div class='empty'><em>No suggestions for this card</em></div>`
}
			${diffTemplates.alternate ? 
		html`
					<div class='row suggestion'>
						<div class='suggestion-text'>
							${diffTemplates.alternate}
						</div>
						<div class='flex'></div>
						<div>
							<button
									class='round'
									title='Accept Alternate Action'
									@click=${this._handleAcceptAlternateActionClicked}
									>
										${CHECK_CIRCLE_OUTLINE_ICON}
									</button>
						</div>
					</div>
				` : ''
}
			${diffTemplates.rejection ? 
		html`
					<div class='row suggestion'>
						<div class='suggestion-text'>
							${diffTemplates.rejection}
						</div>
						<div class='flex'></div>
						<div>
							<button
									class='round'
									title='Reject Suggestion'
									@click=${this._handleRejectActionClicked}
									>
										${CANCEL_ICON}
									</button>
						</div>
					</div>
				` : ''
}
		</div>`;
	}

	override stateChanged(state : State) {
		this._card= selectActiveCard(state);
		this._active = selectSuggestionsOpen(state);
		this._suggestions = selectSuggestionsForActiveCard(state);
		this._selectedIndex = selectSuggestionsEffectiveSelectedIndex(state);
		this._tagInfosForCards = selectTagInfosForCards(state);
		this._userMayUseAI = selectUserMayUseAI(state);
		this._useLLMs = selectSuggestionsUseLLMs(state);
	}

	_handleSuggestionTapped(e : TagEvent) {
		store.dispatch(suggestionsChangeSelected(e.detail.tag));
	}

	_handleCloseClicked() {
		store.dispatch(suggestionsHidePanel());
	}

	_handleAcceptAlternateActionClicked() {
		if (!this._card) throw new Error('No card');
		store.dispatch(applySuggestion(this._card.id, this._selectedIndex, 'alternate',));
	}

	_handleAcceptPrimaryActionClicked() {
		if (!this._card) throw new Error('No card');
		store.dispatch(applySuggestion(this._card.id, this._selectedIndex, 'primary',));
	}

	_handleRejectActionClicked() {
		if (!this._card) throw new Error('No card');
		store.dispatch(applySuggestion(this._card.id, this._selectedIndex, 'rejection',));
	}

	_handleUseLLMsChanged(e : InputEvent) {
		const ele = e.target;
		if (!(ele instanceof HTMLInputElement)) throw new Error('not input ele');
		const checked = ele.checked;
		store.dispatch(suggestionsSetUseLLMs(checked));
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'suggestions-viewer': SuggestionsViewer;
	}
}