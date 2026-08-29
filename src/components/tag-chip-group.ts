//THE OR-GROUP IS A PILL MADE OF PILLS.
//
//The composer's boolean story needs exactly one container that the eye reads as
//"these alternatives are one condition": `(tagged systems or tagged AI)` is a
//single clause in the sentence, and the app already owns the shape a clause
//takes — tag-chip. So this is tag-list's inline rendering with one rounded
//hairline border drawn around it, and nothing else. Members keep their own
//colours; the quiet lowercase "or" between them is content the CALLER supplies,
//because the caller is the one that knows what the members are.
//
//WHY A SLOT AND NOT A `members` PROPERTY. The sentence renderer owns the roving
//tabindex, the aria roles, the negation flags and the per-member selection of
//every pill it draws. A container that took a list of members would have to
//re-express all of that as properties, and the two copies would drift the first
//time the keyboard grammar changed. Slotting means this file holds exactly one
//idea — the border that makes a group one pill — and the sentence keeps every
//decision about what is inside it.

import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('tag-chip-group')
class TagChipGroup extends LitElement {

	static override styles = [
		css`
			/* 0.3em, the same radius tag-chip rounds at, because the group IS a
			   pill and a pill in this app is 0.3em round (proposal A §2d says so
			   explicitly). The hairline is the app's divider, at 1px: the border
			   has to be quiet enough that the members' own colours stay the
			   loudest thing inside it. */
			:host {
				align-items: center;
				border: 1px solid var(--app-divider-color);
				border-radius: 0.3em;
				display: inline-flex;
				flex-wrap: wrap;
				gap: 0.1em;
				margin: 0 0.1em;
				padding: 0.1em 0.2em;
				vertical-align: middle;
			}

			/* SAME RING AS A CHIP, for the same reason: the group is one token in
			   the same traversal, and selecting it must look like selecting any
			   other token. Selection and focus coincide whenever the sentence
			   has focus — see tag-chip's own note. */
			:host(:focus-visible),
			:host([data-selected]) {
				outline: 2px solid var(--app-primary-color);
				outline-offset: 2px;
			}
		`
	];

	override render() {
		return html`<slot></slot>`;
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'tag-chip-group': TagChipGroup;
	}
}
