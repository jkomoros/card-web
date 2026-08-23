import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';

import { connect } from 'pwa-helpers/connect-mixin.js';

import { store } from '../store.js';

import { DialogElement } from './dialog-element.js';

import {
	describeShortcuts,
	CatalogEntry,
	ShortcutGroup
} from '../shortcuts.js';

import {
	formatShortcutCombo
} from '../shortcuts-data.js';

import {
	closeShortcutSheet
} from '../actions/app.js';

import {
	State
} from '../types.js';

//#740 STAGE 2: the shortcuts finally become discoverable.
//
//Stage 1 shipped — the registry, priorities, focus policies, the reserved-combo
//denylist. What it did not ship is display. Nineteen bindings each carry a
//`label`, and shortcuts.ts said in a comment that those labels were "not
//rendered anywhere yet". They are now.
//
//It ENUMERATES THE REGISTRY rather than holding its own list, which is #740's
//own requirement ("a registry that can be enumerated"): a new binding appears
//here automatically, and there is a test that registers a synthetic one to prove
//it. It also never reads SHORTCUT_COMBOS directly and never snapshots at module
//load, because #740's stage 3 is user-configurable bindings and resolving
//through shortcutKeysAll is what leaves that possible.
//
//A DIALOG, not a panel. HOUSE-STYLE §3.2 says a surface with no commit action is
//not a dialog — but read what that rule is aimed at: configure-collection, which
//accumulates uncommitted state behind a scrim that hides the very thing it is
//editing. A read-only reference overlay mutates nothing and hides nothing it
//needs, and it wants exactly what §3.3's contract already provides. A 13em panel
//would not fit twenty rows anyway, and §3.1 defines a panel as context tied to
//the CURRENT CARD, which a global key list is not.

const GROUP_HEADINGS : {[group in ShortcutGroup] : {title : string, note : string}} = {
	//The note is the focus policy in prose, stated ONCE per group rather than
	//repeated on every row.
	//NOT "when you are not typing". Most of these need that, but blur-focused
	//is focusPolicy 'any-focus' and its entire job is to blur the thing you ARE
	//typing in — the note stated the opposite of the truth for that row. Per-row
	//context is the honest fix; until then the heading does not claim something
	//false about one of its own entries.
	'browsing': {title: 'Browsing cards', note: 'Most of these need the card list focused, not a text field'},
	'editing': {title: 'Editing a card', note: 'Including from the title and notes fields'},
	'formatting': {title: 'Formatting text', note: 'Only while the caret is in a card’s body'},
	'dialogs': {title: 'Dialogs', note: ''},
};

const GROUP_ORDER : ShortcutGroup[] = ['browsing', 'editing', 'formatting', 'dialogs'];

@customElement('shortcut-sheet')
class ShortcutSheet extends connect(store)(DialogElement) {

	@state()
		_entries : CatalogEntry[] = [];

	static override styles = [
		...DialogElement.styles,
		css`
			h3 {
				font-weight: normal;
				color: var(--app-dark-text-color);
				margin: 1em 0 0.25em 0;
			}

			.note {
				font-size: 0.75em;
				color: var(--app-dark-text-color);
				margin-bottom: 0.5em;
			}

			.row {
				display: grid;
				grid-template-columns: 1fr auto;
				gap: 1em;
				padding: 0.15em 0;
			}

			/* tabular-nums so the combos line up down the column, following
			   corpus-status-indicator. No keycap chips: this repo has no such
			   idiom and §4.4 says core surfaces are square — inventing one is
			   how a twelfth border-radius gets added. */
			.keys {
				color: var(--app-dark-text-color);
				font-variant-numeric: tabular-nums;
				white-space: nowrap;
			}
		`
	];

	override innerRender() {
		return html`
			${GROUP_ORDER.map(group => this._renderGroup(group))}
		`;
	}

	private _renderGroup(group : ShortcutGroup) {
		const entries = this._entries.filter(entry => entry.group === group);
		if (!entries.length) return html``;
		const heading = GROUP_HEADINGS[group];
		return html`
			<h3>${heading.title}</h3>
			${heading.note ? html`<div class='note'>${heading.note}</div>` : ''}
			${entries.map(entry => html`
				<div class='row'>
					<span>${entry.label}</span>
					<span class='keys'>${this._combos(entry)}</span>
				</div>`)}
		`;
	}

	//From the CATALOG's own keys, not SHORTCUT_COMBOS[id].
	//
	//The lookup version had two faults that review demonstrated. It cast
	//entry.id to ShortcutID, and both register() and declareShortcut() accept
	//any string — so one catalogued id outside the table threw inside the map()
	//and rendered the WHOLE sheet blank: zero rows under a "Keyboard Shortcuts"
	//heading. And it defeated the thing the commit claimed it enabled: #740's
	//stage 3 is user-configurable bindings, and a binding registered with
	//overridden keys still displayed the frozen table's combo. catalog() already
	//stores keys; using them fixes both.
	private _combos(entry : CatalogEntry) : string {
		const keys = Array.isArray(entry.keys) ? entry.keys : [entry.keys];
		const rendered = keys.map(combo => formatShortcutCombo(combo));
		//Spellings that differ ONLY by shift are the same physical key on
		//different layouts, and exactly one of them is pressable on yours.
		//Showing both produced "Shift-? or ?", which is not an instruction
		//anyone can follow — it is an implementation detail leaked into the
		//reference (§1.4).
		const deduped = rendered.filter((text, index) => {
			const bare = text.replace(/^Shift-/, '');
			return !rendered.some((other, otherIndex) => otherIndex < index && other.replace(/^Shift-/, '') === bare);
		});
		return deduped.join(' or ');
	}

	override _shouldClose() {
		store.dispatch(closeShortcutSheet());
	}

	override stateChanged(state : State) {
		this.open = state.app.shortcutSheetOpen;
		this.mobile = state.app.mobileMode;
		//Re-read on every change rather than snapshotting: bindings are
		//catalogued as their modules load, and #740's stage 3 makes them
		//user-editable.
		if (this.open) this._entries = describeShortcuts();
	}

	constructor() {
		super();
		this.title = 'Keyboard Shortcuts';
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'shortcut-sheet': ShortcutSheet;
	}
}
