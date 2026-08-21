//The one shared progress surface for long-running operations (#758). A
//user who has seen one long operation should recognize the next: multi-edit
//grew a designed panel (heading, determinate progress, honest count line,
//details disclosure) while bulk import scrimmed with NOTHING — a translucent
//rectangle over a form for a minutes-long operation — and each surface
//invented its own vocabulary for the same three-valued truth. This element
//is that panel, extracted verbatim from multi-edit-dialog's styles so the
//baseline look is the one that already received design attention.
//
//It is a dumb presentational element on purpose: plain properties, no store
//connection, so any dialog (or the editor, if it ever wants a countable
//total) can host it inside its own scrim.

import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('progress-panel')
export class ProgressPanel extends LitElement {

	@property({ type : String })
		heading : string;

	//When total is 0 the bar renders indeterminate.
	@property({ type : Number })
		total : number;

	@property({ type : Number })
		value : number;

	//The honest count line: "8 of 32" must say 8 of 32 WHAT (arrived in
	//this tab, acked by the server, persisted locally). Callers compose it.
	@property({ type : String })
		countText : string;

	//Collapsed mechanics for advanced users (what "processed safely"
	//promises, the backgrounding caveat). One string per paragraph.
	@property({ type : Array })
		detailParagraphs : string[];

	//Body-size explanatory text (a waiting state's reassurance). Rendered as
	//a normal paragraph, NOT the small .count line.
	@property({ type : String })
		messageText : string;

	//Renders an animated indeterminate bar when total is 0. A waiting state
	//that shows no activity (offline) should leave this off: an animated bar
	//implies progress that is not happening.
	@property({ type : Boolean })
		indeterminate : boolean;

	static override styles = [
		css`
			/* The same treatment as dialog .content (white, 1em padding,
			   var(--card-shadow), square corners) rather than a novel
			   floating-banner look — see multi-edit-dialog, where this
			   surface was designed. */
			:host {
				background-color: var(--card-color, white);
				box-shadow: var(--card-shadow);
				padding: 1em;
				box-sizing: border-box;
				max-width: 26em;
				display: flex;
				flex-direction: column;
				gap: 0.75em;
				text-align: left;
			}

			/* Normal weight, like dialog titles (dialog-element h2) — but NOT
			   their gray: --app-dark-text-color is calibrated for 24px
			   headings, and at this size it fails AA contrast. Inherit the
			   near-black body color instead. */
			h3 {
				margin: 0;
				font-weight: normal;
				font-size: 1.2em;
				overflow-wrap: anywhere;
			}

			progress {
				width: 100%;
				accent-color: var(--app-secondary-color);
			}

			/* De-emphasized by SIZE, not by gray: the small grays that carry
			   secondary text elsewhere in the app fail AA at these sizes. */
			.count {
				font-size: 0.85em;
			}

			p {
				margin: 0;
			}

			/* <details> is the app's existing progressive-disclosure idiom
			   (chat-view, maintenance-view, the card-selection summary). */
			details {
				font-size: 0.85em;
			}

			details p {
				margin: 0.4em 0 0 0;
			}

			summary {
				cursor: pointer;
			}
		`
	];

	override render() {
		return html`
			<h3>${this.heading}</h3>
			${this.messageText ? html`<p>${this.messageText}</p>` : ''}
			${this.total > 0
		? html`<progress aria-label=${this.heading} max=${this.total} value=${this.value || 0}></progress>`
		: this.indeterminate
			? html`<progress aria-label=${this.heading}></progress>`
			: ''}
			${this.countText ? html`<span class='count'>${this.countText}</span>` : ''}
			${this.detailParagraphs && this.detailParagraphs.length ? html`
				<details>
					<summary>Details</summary>
					${this.detailParagraphs.map(paragraph => html`<p>${paragraph}</p>`)}
				</details>` : ''}
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'progress-panel': ProgressPanel;
	}
}
