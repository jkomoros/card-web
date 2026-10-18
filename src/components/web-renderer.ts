import { html, LitElement, svg, css, PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

import * as d3 from 'd3';

import { store } from '../store.js';

import {
	selectCards,
	selectCardMetas
} from '../selectors.js';

import {
	CardID,
	CardMetas,
	ProcessedCards,
	State,
	WebInfo,
	WebInfoNodeWithLayout,
	WebInfoWithLayout
} from '../types.js';

import {
	beginDisplayTitleBudget,
	DisplayTitleInputs,
	graphNodeName,
	selectDisplayTitleInputs,
	subscribeDisplayTitles
} from '../working-notes-display-title.js';

import {
	makeCardHoveredEvent,
	makeThumbnailTappedEvent
} from '../events.js';

@customElement('web-renderer')
export class WebRenderer extends connect(store)(LitElement) {

	//as returned from e.g. collection.webInfo
	@property({ type : Object })
		webInfo: WebInfo | null;

	@property({ type : String })
		highlightedCardId: CardID;

	@state()
		_calculatedGraph: WebInfoWithLayout;

	@state()
		_cards : ProcessedCards = {};

	@state()
		_cardMetas : CardMetas | null = null;

	@state()
		_displayTitleInputs : DisplayTitleInputs | null = null;

	_unsubscribeDisplayTitles : (() => void) | null = null;

	static override styles = [
		css`
			:host {
				height:100%;
				width:100%;
			}
			svg {
				height: 100%;
				width: 100%;
			}
			circle {
				fill: var(--app-primary-color);
				z-index:1;
				cursor:pointer;
			}
			circle:hover {
				fill: var(--app-primary-color-light);
			}
			line {
				stroke:var(--app-dark-text-color-light);
				z-index:0;
			}
			circle.highlighted:hover {
				fill: var(--app-secondary-color-light);
			}
			.highlighted {
				fill: var(--app-secondary-color);
			}
		`
	];

	override render() {
		const width = this.offsetWidth;
		const height = this.offsetHeight;
		//Titles the worker has not frozen yet are computed within this
		//render's budget and the rest filled in idle slices (the subscription
		//below re-renders as they land), so a cold graph of hundreds of notes
		//does not pay ~1.4ms a node on top of the layout.
		beginDisplayTitleBudget();
		return html`
		<svg viewBox=${'0 0 ' + width + ' ' + height}>
			${this._calculatedGraph.edges.map(edge => svg`<line x1=${edge.source.x} x2=${edge.target.x} y1=${edge.source.y} y2=${edge.target.y} stroke-width='1'></line>`)}	
			${this._calculatedGraph.nodes.map(node => svg`<circle id=${node.id} r='4' cx=${node.x} cy=${node.y} class=${node.id == this.highlightedCardId ? 'highlighted' : ''} @click=${this._handleThumbnailClick} @mousemove=${this._handleThumbnailMouseMove}><title>${this._nodeName(node)}</title></circle>`)}
		</svg>
	`;
	}

	//The label is a child <title>, which is what SVG renders as a tooltip; a
	//`title` attribute on a circle is not one. Working notes store no
	//authored title, so the label is the same computed display title the
	//list shows.
	_nodeName(node : WebInfoNodeWithLayout) : string {
		const card = this._cards[node.id];
		if (!card || !this._displayTitleInputs) return node.name;
		return graphNodeName(card, this._cardMetas, this._displayTitleInputs);
	}

	override connectedCallback() {
		super.connectedCallback();
		this._unsubscribeDisplayTitles = subscribeDisplayTitles(() => this.requestUpdate());
	}

	override disconnectedCallback() {
		if (this._unsubscribeDisplayTitles) this._unsubscribeDisplayTitles();
		this._unsubscribeDisplayTitles = null;
		super.disconnectedCallback();
	}

	_handleThumbnailClick(e : MouseEvent) {
		e.stopPropagation();
		const ele = e.composedPath()[0];
		if (!(ele instanceof SVGElement)) throw new Error('not svg element');
		const card = ele.id;
		const ctrl = e.ctrlKey || e.metaKey;
		//TODO: ctrl-click on mac shouldn't show the right click menu
		this.dispatchEvent(makeThumbnailTappedEvent(card, ctrl));
	}

	_handleThumbnailMouseMove(e : MouseEvent) {
		e.stopPropagation();
		const ele = e.composedPath()[0];
		if (!(ele instanceof SVGElement)) throw new Error('not svg element');
		const id = ele.id;
		//card-web-app will catch the card-hovered event no matter where it was
		//thrown from
		this.dispatchEvent(makeCardHoveredEvent(id, e.clientX, e.clientY));
	}

	_recalcGraph() : WebInfoWithLayout {
		if (!this.webInfo) return {nodes:[], edges:[]};
		//Make a deep copy of the graph, because d3 will operate on it.
		const graph = {...this.webInfo};
		if (Object.keys(graph).length == 0) return {nodes:[], edges:[]};
		graph.nodes = [...graph.nodes];
		graph.edges = [...graph.edges];

		//It's gnarly to have this layout-dependent thing in here
		const width = this.offsetWidth;
		const height = this.offsetHeight;

		const simulation = d3.forceSimulation(graph.nodes as d3.SimulationNodeDatum[])
			.force('link', d3.forceLink(graph.edges).id((d : WebInfoNodeWithLayout) => d.id))
			.force('charge', d3.forceManyBody())
			.force('center', d3.forceCenter(width / 2, height / 2))
			.stop();
		
		for (let i = 0; i < 300; ++i) simulation.tick();
		return {
			nodes: graph.nodes as WebInfoNodeWithLayout[],
			edges: graph.edges.map(edge => ({source: edge.source as unknown as WebInfoNodeWithLayout, target: edge.target as unknown as  WebInfoNodeWithLayout, value: edge.value})),
		};
	}

	constructor() {
		super();
		this._calculatedGraph = {nodes:[], edges:[]};
	}

	override stateChanged(state : State) {
		this._cards = selectCards(state);
		this._cardMetas = selectCardMetas(state);
		this._displayTitleInputs = selectDisplayTitleInputs(state);
	}

	override updated(changedProps : PropertyValues<this>) {
		if (changedProps.has('webInfo')) {
			this._calculatedGraph = this._recalcGraph();
		}
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'web-renderer': WebRenderer;
	}
}
