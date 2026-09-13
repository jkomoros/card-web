import { html, LitElement, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
	SCREEN_ROTATION_ICON,
} from '../../shared/icons.js';

// These are the shared styles needed by this element.
import { SharedStyles } from './shared-styles.js';

import { ButtonSharedStyles } from './button-shared-styles.js';
import { 
	CARD_WIDTH_IN_EMS,
	CARD_HORIZONTAL_PADDING_IN_EMS,
	CARD_HEIGHT_IN_EMS,
	CARD_VERTICAL_PADDING_IN_EMS,
	CardRenderer
} from './card-renderer.js';

import {
	setFontSizingCardRendererProvider
} from '../card_methods.js';

import {
	ProcessedCard,
	Card,
	CardID,
	CardFieldMap
} from '../types.js';

import {
	ExpandedReferenceBlocks
} from '../reference_blocks.js';

@customElement('card-stage')
export class CardStage extends LitElement {

	@property({ type : Boolean })
		mobile: boolean;

	@property({ type : Boolean })
		loading: boolean;

	@property({ type : Boolean })
		presenting: boolean;

	@property({ type : Boolean })
		highPadding: boolean;

	@property({ type : Boolean })
		dataIsFullyLoaded : boolean;

	@property({ type : Boolean })
		editing: boolean;

	@property({ type : Boolean })
		cardModificationsPending: boolean;

	//True while the rendered card is a committed-but-unconfirmed save (the
	//optimistic face a single-card save shows before the server settles it).
	//Renders a small "Saving…" chip anchored to the card; the card content
	//itself stays full-strength.
	@property({ type : Boolean })
		pendingSave: boolean;

	@property({ type : Boolean})
		hideActions: boolean;

	//THE CARD IS ABSENT, THE STAGE IS NOT.
	//
	//When a collection matches nothing there is no card to draw, and card-view
	//used to answer that by hiding this whole element. But every action control
	//in the app is SLOTTED INTO this element — the drawer toggle, star, reading
	//list, edit, info, next/prev — and SharedStyles' `[hidden]{display:none
	//!important}` took all of them with it. An empty collection is the state in
	//which refining it is the only useful thing left to do, and it was the state
	//with no controls.
	//
	//So the CARD hides and the stage stays, with whatever the host wants in the
	//card's place going into the `no-card` slot below — in the same centred
	//position, with the action rail in its usual place under it.
	@property({ type : Boolean})
		cardHidden: boolean;

	@property({ type : Object })
		card: ProcessedCard | Card | null;

	@property({ type : Object })
		updatedFromContentEditable: CardFieldMap;

	@property({ type : Array })
		expandedReferenceBlocks: ExpandedReferenceBlocks;

	@property({ type : Array })
		suggestedConcepts: CardID[];

	static override styles = [
		ButtonSharedStyles,
		SharedStyles,
		css`
			:host, #canvas {
				flex-grow: 1;
				display:flex;
				flex-direction:column;
				justify-content:center;
				align-items: center;
				background-color: var(--canvas-color);
				position:relative;
			}

			#canvas {
				height:100%;
				width:100%;
			}

			[name=tags] {
				margin:0.5em;
			}

			#canvas.presenting  {
				background-color: var(--app-dark-text-color);
			}

			.presenting {
				--shadow-color:#444;
				/* have to redefine it because it uses the variables at the site where it's derived */
				--card-shadow: var(--card-shadow-first-part) var(--shadow-color);
			}

			.presenting [name="tags"] {
				display:none;
			}

			.presenting [name="actions"] {
				position:absolute;
				bottom:0.5em;
				right:0.5em;
				display:flex;
				flex-direction:column;
				opacity: 0.3;
				transition: opacity var(--transition-fade);
			}

			/* THE MOBILE TOOLBAR MUST NOT LOSE CONTROLS.
			   Ten round buttons in a nowrap row with overflow visible, inside a
			   column that centres its children: at 375px the row measured far
			   wider than the viewport and the centring pushed its LEFT edge off
			   screen. The live review measured the first item — the composer's
			   own 'Compose collection' button — at x=-107, unreachable by any
			   gesture.

			   WRAPPING, not horizontal scrolling. Wrapping is this app's own
			   narrow-screen toolbar idiom (the composer's .source-steps wrap;
			   so do collection-pill-row's argument controls), and it needs no
			   scroll affordance to discover: every control is simply on
			   screen. max-width is what bounds the row
			   against the centring, and the slotted groups wrap inside
			   themselves because their round buttons are inline-block. */
			/* :not(.presenting) — THE WRAP IS FOR THE NARROW TOOLBAR, NOT FOR
			   THE PRESENTATION RAIL. These two rules land at equal specificity
			   with the .presenting block above and are declared after it, so on
			   a phone in presentation mode they applied on top of it: a column
			   rail, absolutely positioned in the corner, acquiring flex-wrap
			   and a max-width meant for a full-width row. Nothing visibly moved
			   (the rail is height-unconstrained, so a column wrap has nowhere
			   to wrap TO), which is exactly why it needed scoping rather than
			   watching — the two states have different layouts and only one of
			   them has the problem this fixes. */
			.mobile:not(.presenting) [name="actions"] {
				flex-wrap: wrap;
				justify-content: center;
				max-width: 100%;
			}

			.mobile:not(.presenting) [name="actions"]::slotted(*) {
				font-size:0.8em;
				max-width: 100%;
			}

			.presenting [name="actions"]:hover {
				opacity:1.0;
			}

			.presenting [name="actions"]::slotted(*) {
				display:flex;
				flex-direction: column;
			}

			[name="actions"]{
				/* This is a hack to allow the information/edit buttons to be on
				top of a section-head-card container. See #44.
				main-view.may-not-view also sets styles to be on top of this.*/
				z-index: 1;
				display:flex;
				flex-direction:row;
			}

			.hide-actions [name="actions"], .hide-actions [name="tags"] {
				display:none;
			}

			[hidden] {
				display:none;
			}

			card-renderer {
				/* this will be overridden via an explicit property set directly on card-renderer */
				font-size:20px;
			}

			#portrait-message {
				display:none;
			}

			#portrait-message svg {
				fill: var(--app-light-text-color);
				height:1em;
				width: 1em;
			}

			card-renderer {
				transition: opacity ease-in-out 0.2s;
			}

			.loading card-renderer {
				opacity: 0.6;
			}

			/* Shrink-wraps the main card-renderer so the pending-save chip can
			anchor to the card's actual corner (the card is flex-centered in a
			much larger canvas, so the canvas corner is not "near the card"). */
			#card-container {
				position: relative;
				display: flex;
			}

			/* The unconfirmed-save chip: same pill grammar as the app-level
			save-status indicator (white pill, status dot, small fixed rem type
			that doesn't scale with the card), with the dot in
			--app-pending-color — the palette's designated "your change has not
			reached the server yet" hue, already used by the corpus status
			glyph's pending layer. Sits just above the card's top-right corner:
			adjacent to the content the user is verifying, covering none of it,
			and never dimming it. */
			#unconfirmed-save {
				position: absolute;
				bottom: calc(100% + 0.4rem);
				right: 0;
				display: flex;
				align-items: center;
				gap: 0.4rem;
				padding: 0.2rem 0.55rem;
				border-radius: 1rem;
				background: rgba(255, 255, 255, 0.94);
				box-shadow: 0 1px 5px rgba(0, 0, 0, 0.18);
				font: 0.78rem var(--app-default-font-family);
				color: var(--app-dark-text-color);
				white-space: nowrap;
				z-index: 1;
			}

			#unconfirmed-save .dot {
				width: 0.5rem;
				height: 0.5rem;
				flex-shrink: 0;
				border-radius: 50%;
				background: var(--app-pending-color);
			}

			@media (orientation:portrait) {
				/* If we're in portrait mode there's more space for the actions along
				the bottom rail, not the right rail */

				.presenting [name="actions"] {
					flex-direction:row;
				}

				.presenting [name="actions"]::slotted(*) {
					flex-direction: row;
				}

				.mobile #portrait-message {
					color: var(--app-light-text-color);
					font-size:1.2em;
					opacity:0.3;
					display:flex;
					flex-direction:row;
					justify-content:center;
					align-items: center;
					width:100%;
					position: absolute;
					top: 0.5em;
					left: 0.5em;
				}

				#portrait-message > div {
					margin:0.5em;
				}
			}
		`
	];

	override render() {
		return html`
		<div id='canvas' class="${this.presenting ? 'presenting' : ''} ${this.editing ? 'editing' : ''} ${this.mobile ? 'mobile' : ''} ${this.loading ? 'loading' : ''} ${this.hideActions ? 'hide-actions' : ''}">
			<div id='portrait-message'>
				<div>${SCREEN_ROTATION_ICON}</div>
				<div>Rotate your device for larger text</div>
			</div>
			<div id='card-container' ?hidden=${this.cardHidden}>
				<card-renderer id='main' .dataIsFullyLoaded=${this.dataIsFullyLoaded} .editing=${this.editing} .cardModificationsPending=${this.cardModificationsPending} .card=${this.card} .updatedFromContentEditable=${this.updatedFromContentEditable} .expandedReferenceBlocks=${this.expandedReferenceBlocks} .suggestedConcepts=${this.suggestedConcepts}></card-renderer>
				${this.pendingSave ? html`
					<!-- aria-hidden: the app-level save-status pill is the
					live region that announces "Saving card…"; announcing the
					same status twice from two regions double-speaks in screen
					readers. This chip is the visual, card-adjacent echo. -->
					<div id='unconfirmed-save' aria-hidden='true'><span class='dot'></span><span>Saving…</span></div>
				` : ''}
			</div>
			<card-renderer id='sizing' style='position:absolute;visibility:hidden;z-index:-100;'></card-renderer>
			<!-- What stands where the card would be when there is no card. Empty
			     in every ordinary state, and a slot with nothing assigned takes
			     no space. -->
			<slot name='no-card'></slot>
			<slot name='actions'></slot>
			<slot name='tags'></slot>
		</div>
	`;
	}

	//Call this whenever the card might need to be resized (other than the
	//window resizing, which the component will call itself)
	resizeCard() {
		let fontSize = 20;
		const shadowRoot = this.shadowRoot;
		if (!shadowRoot) throw new Error('no shadowroot');
		const canvas = shadowRoot.getElementById('canvas');
		if (!canvas) {
			console.warn('Couldn\'t find canvas element');
			return;
		}

		const rect = canvas.getBoundingClientRect();


		const paddingInPx = Math.round(rect.width / (this.highPadding ? 12 : 40));
		//Next two come from the style for card-renderer
		const cardWidthInEms = CARD_WIDTH_IN_EMS;
		const cardWidthPaddingInEms = 2 * (CARD_HORIZONTAL_PADDING_IN_EMS);

		const cardHeightInEms = CARD_HEIGHT_IN_EMS;
		const cardHeightPaddingInEms = 2 * (CARD_VERTICAL_PADDING_IN_EMS);

		const totalCardWidthInEms = cardWidthInEms + cardWidthPaddingInEms;
		const totalCardHeighInEms = cardHeightInEms + cardHeightPaddingInEms;

		const targetWidth = rect.width - paddingInPx;
		//TODO: take into account size of actions bar.
		//On small screens don't worry about any vertical padding.
		const targetHeight = rect.height - (this.mobile ? 0 : paddingInPx);

		const widthFontSize = targetWidth / totalCardWidthInEms;
		const heightFontSize = targetHeight / totalCardHeighInEms;

		//Pick the smaller of the two
		fontSize = widthFontSize;
		if (heightFontSize < fontSize) fontSize = heightFontSize;

		const renderer = shadowRoot.querySelector('card-renderer');
		if (!renderer) {
			console.warn('Couldn\'t find card-renderer to update its size');
			return;
		}

		renderer.style.fontSize = '' + fontSize + 'px';
	}

	get mainCardRenderer() : CardRenderer {
		const shadowRoot = this.shadowRoot;
		if (!shadowRoot) throw new Error('no shadowroot');
		return shadowRoot.querySelector('#main') as CardRenderer;
	}

	get sizingCardRenderer() : CardRenderer {
		const shadowRoot = this.shadowRoot;
		if (!shadowRoot) throw new Error('no shadowroot');
		return shadowRoot.querySelector('#sizing') as CardRenderer;
	}

	override firstUpdated() {
		setFontSizingCardRendererProvider(this);
		window.addEventListener('resize', () => this.resizeCard());
		this.resizeCard();
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'card-stage': CardStage;
	}
}
