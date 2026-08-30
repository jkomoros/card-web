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
import { customElement, property } from 'lit/decorators.js';

@customElement('tag-chip-group')
class TagChipGroup extends LitElement {

	//THE GROUP IS FLIPPED, NOT ONE OF ITS MEMBERS.
	//
	//tag-chip's rule is that fill inversion mirrors meaning inversion. A group
	//is where that rule matters most and where it was not applied: the negation
	//rendered as a floating "not" beside a row of solid pills, which reads as
	//`(not tag-1) or tag-2` — a different collection from the one it named. So
	//the container takes the inversion, as a unit, and the word that says so
	//lives inside its boundary (the sentence renderer slots it there).
	@property({ type : Boolean, reflect : true })
		negated = false;

	static override styles = [
		css`
			/* 0.3em, the same radius tag-chip rounds at, because the group IS a
			   pill and a pill in this app is 0.3em round (proposal A §2d says so
			   explicitly).

			   THE HAIRLINE WAS INVISIBLE. --app-divider-color is #eee, drawn 1px
			   wide, on a white dialog: the one mark that says "these two pills
			   are one condition" could not be seen at all, and the thing it was
			   quiet enough not to compete with was itself. It takes the
			   subordinate TEXT colour instead — the same token the sentence's own
			   operators use, so the border is exactly as loud as the "or" it
			   contains — over a very transparent wash that gives the container a
			   surface as well as an edge. The padding grows with it: a boundary
			   the members are pressed against does not read as containment. */
			:host {
				align-items: center;
				background: var(--app-primary-color-light-very-transparent);
				border: 1px solid var(--app-dark-text-color-light);
				border-radius: 0.3em;
				display: inline-flex;
				flex-wrap: wrap;
				gap: 0.1em;
				margin: 0 0.1em;
				padding: 0.15em 0.35em;
				vertical-align: middle;
			}

			/* THE NEGATED GROUP, INVERTED AS ONE THING. tag-chip's negated pill
			   trades its fill for its outline; a negated group does the same at
			   container scale — the wash goes, and the edge doubles and darkens
			   to the weight of a border that means something rather than one
			   that merely encloses. The members keep their own colours, for
			   tag-chip's own reason: negation does not change which tags a
			   clause is about. */
			:host([negated]) {
				background: var(--app-light-text-color);
				border-color: var(--app-dark-text-color-darker);
				border-width: 2px;
				padding: calc(0.15em - 1px) calc(0.35em - 1px);
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
