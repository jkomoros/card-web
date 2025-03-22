import { html, LitElement, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
	SCREEN_ROTATION_ICON,
} from './my-icons.js';

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

	@property({ type : Boolean})
		hideActions: boolean;

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

			.mobile [name="actions"]::slotted(*) {
				font-size:0.8em;
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
			<card-renderer id='main' .dataIsFullyLoaded=${this.dataIsFullyLoaded} .editing=${this.editing} .cardModificationsPending=${this.cardModificationsPending} .card=${this.card} .updatedFromContentEditable=${this.updatedFromContentEditable} .expandedReferenceBlocks=${this.expandedReferenceBlocks} .suggestedConcepts=${this.suggestedConcepts}></card-renderer>
			<card-renderer id='sizing' style='position:absolute;visibility:hidden;z-index:-100;'></card-renderer>
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
