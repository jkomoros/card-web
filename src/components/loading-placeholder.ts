import { LitElement, html, css, PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';

//THE FOURTH TEMPORAL STATE FINALLY GETS A PRIMITIVE.
//
//HOUSE-STYLE §3.6 names four states — loading, in flight, pending, blocked —
//and loading was the only one with no shared treatment. An audit found EIGHT
//competing idioms: a dimmed list with an 'updating…' CSS pin, a bare
//'Loading...', an <em>loading…</em>, a boot placeholder, 'Preparing search
//(X of Y cards indexed)…', an unguarded pulse animation, a stale-content dim at
//a different opacity whose comment claims to match the drawer's, and a progress
//ring on a status dot.
//
//Four of those already agree on a vocabulary — 0.7-0.75em, italic, subordinate
//colour, and where content is dimmed a ~0.15s ease-in. This CODIFIES that rather
//than inventing a ninth.
//
//LOADING IS NOT IN FLIGHT. The user did not ask for this; it is the cost of
//arriving. So this deliberately does not look like progress on a user action:
//no <progress>, no scrim, no cancel. Work the user DID ask for belongs to
//progress-panel, and confusing the two is what makes a slow boot read as a
//stuck operation.
//
//WHY TEXT AND A DIM RATHER THAN SKELETONS. Three reasons, none of them taste:
//  - Card geometry is not predictable. card-renderer sizes text to fit against
//    card-stage's 20px anchor, so a skeleton's rectangles would misrepresent
//    what is coming.
//  - This repo has already argued it in the negative. card-drawer's comments
//    explain why it HIDES rather than destroys (losing the list's scroll
//    position) and why "0 cards" plus a pin reads as "this list is empty and
//    something is wrong" on a slow first visit.
//  - Loading can end in NOTHING arriving. A skeleton asserts that content of
//    this shape is coming; a line of text does not.

//The words, in one place. Exported because two call sites cannot host an
//element — card-renderer writes its placeholder into innerHTML — and the point
//is that they still say the same thing.
export const loadingLabel = (noun : string) : string => `Loading ${noun}…`;

//For the HOST to put on the element it is dimming. The dim must apply to the
//host's own scroller, which owns the scroll position; applying it here would
//mean this element wrapping content it has no business owning.
export const LoadingSharedStyles = css`
	.loading-dim {
		opacity: 0.55;
		transition: opacity 0.15s ease-in;
	}

	@media (prefers-reduced-motion: reduce) {
		.loading-dim {
			transition: none;
		}
	}
`;

@customElement('loading-placeholder')
export class LoadingPlaceholder extends LitElement {

	//WHAT has not arrived, in the user's vocabulary (§1.4): 'cards',
	//'comments', 'the search index'. Composed as 'Loading cards…' rather than a
	//bare 'Loading...', because which thing is missing is the useful half.
	@property({ type : String })
		noun = '';

	//True once SOME of it has arrived and the host is still rendering the stale
	//version underneath. Switches from the placeholder line to a non-blocking
	//pin. This is card-drawer's behaviour, generalized: the host keeps its DOM
	//mounted, so the scroll position survives.
	//reflect, because :host([partial]) keys off the ATTRIBUTE. Lit does not
	//reflect by default, and this exact mistake shipped twice already on this
	//branch — the snack bar's mobile branch was dead code for the same reason.
	@property({ type : Boolean, reflect : true })
		partial = false;

	//Honest counts only (§3.6.3). A total of 0 or less means unknown, and the
	//count then reads 'N so far' — it never invents a denominator.
	@property({ type : Number })
		value = 0;

	@property({ type : Number })
		total = 0;

	//A second, subordinate line when the app genuinely knows why the wait is
	//long. NOT a place for an error: a failure outranks loading, and saying
	//'Loading…' about something that is not coming is the lie card-drawer's
	//comments already reject.
	@property({ type : String })
		detail = '';

	//Suppress the placeholder for this long, so a fast arrival does not flash a
	//message the user cannot read. Per-instance and cleared on disconnect —
	//deliberately not a module timer, which is the bug the snack bar had.
	@property({ type : Number })
		delayMs = 0;

	private _delayHandle : number | null = null;
	private _delayElapsed = false;

	static override styles = [
		css`
			:host {
				display: block;
			}

			/* The vocabulary four of the eight idioms already shared. Subordinate
			   by SIZE and by italic, NOT by the lighter grey: that token is
			   2.32:1 on white and fails WCAG AA outright.
			   corpus-status-indicator and progress-panel both carry comments
			   rejecting it for exactly this reason, and this branch shipped
			   that mistake once already. */
			.placeholder {
				font-size: 0.75rem;
				font-style: italic;
				color: var(--app-dark-text-color-darker);
			}

			/* The non-blocking pin, from card-drawer: stays legible over
			   whatever stale content is showing underneath it. */
			:host([partial]) .placeholder {
				position: absolute;
				top: 0.5em;
				right: 0.5em;
				font-size: 0.7em;
				background: rgb(255 255 255 / 88%);
				padding: 0 0.3em;
				border-radius: 3px;
			}

			.detail {
				font-size: 0.7rem;
				font-style: italic;
				color: var(--app-dark-text-color-darker);
			}
		`
	];

	//What the line says. Counts appear only when they mean "how much of MY
	//stuff is here" and the total is genuinely known.
	private get _label() : string {
		if (this.partial) return 'updating…';
		if (!this.noun) return '';
		if (this.total > 0) return `${loadingLabel(this.noun)} (${this.value.toLocaleString()} of ${this.total.toLocaleString()})`;
		//No denominator invented: §3.6.3's "12.4k↑" case, in a one-line register.
		if (this.value > 0) return `${loadingLabel(this.noun)} (${this.value.toLocaleString()} so far)`;
		return loadingLabel(this.noun);
	}

	override render() {
		//A noun is required. Rendering 'Loading undefined…' is worse than
		//rendering nothing.
		if (!this.noun && !this.partial) return html``;
		if (this.delayMs && !this._delayElapsed) return html``;
		return html`
			<span class='placeholder' role='status' aria-live='polite'>${this._label}</span>
			${this.detail ? html`<div class='detail'>${this.detail}</div>` : ''}
		`;
	}

	override willUpdate(changedProps : PropertyValues<this>) {
		super.willUpdate(changedProps);
		if (!changedProps.has('delayMs')) return;
		this._clearDelay();
		this._delayElapsed = !this.delayMs;
		if (!this.delayMs) return;
		this._delayHandle = window.setTimeout(() => {
			this._delayHandle = null;
			this._delayElapsed = true;
			this.requestUpdate();
		}, this.delayMs);
	}

	private _clearDelay() {
		if (this._delayHandle === null) return;
		window.clearTimeout(this._delayHandle);
		this._delayHandle = null;
	}

	override disconnectedCallback() {
		this._clearDelay();
		super.disconnectedCallback();
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'loading-placeholder': LoadingPlaceholder;
	}
}
