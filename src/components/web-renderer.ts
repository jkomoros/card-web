import { html, LitElement, svg, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import * as d3 from 'd3';

import {
	CardID,
	WebInfo,
	WebInfoNodeWithLayout,
	WebInfoWithLayout
} from '../types.js';

import {
	makeCardHoveredEvent,
	makeThumbnailTappedEvent
} from '../events.js';

@customElement('web-renderer')
export class WebRenderer extends LitElement {

	//as returned from e.g. collection.webInfo
	@property({ type : Object })
	webInfo: WebInfo;

	@property({ type : String })
	highlightedCardId: CardID;

	@state()
	_calculatedGraph: WebInfoWithLayout;

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
		return html`
		<svg viewBox=${'0 0 ' + width + ' ' + height}>
			${this._calculatedGraph.edges.map(edge => svg`<line x1=${edge.source.x} x2=${edge.target.x} y1=${edge.source.y} y2=${edge.target.y} stroke-width='1'></line>`)}	
			${this._calculatedGraph.nodes.map(node => svg`<circle id=${node.id} title=${node.name} r='4' cx=${node.x} cy=${node.y} class=${node.id == this.highlightedCardId ? 'highlighted' : ''} @click=${this._handleThumbnailClick} @mousemove=${this._handleThumbnailMouseMove}></circle>`)}
		</svg>
	`;
	}

	_handleThumbnailClick(e : MouseEvent) {
		e.stopPropagation();
		let ele = e.composedPath()[0];
		if (!(ele instanceof SVGElement)) throw new Error('not svg element');
		let card = ele.id;
		const ctrl = e.ctrlKey || e.metaKey;
		//TODO: ctrl-click on mac shouldn't show the right click menu
		this.dispatchEvent(makeThumbnailTappedEvent(card, ctrl));
	}

	_handleThumbnailMouseMove(e : MouseEvent) {
		e.stopPropagation();
		let ele = e.composedPath()[0];
		if (!(ele instanceof SVGElement)) throw new Error('not svg element');
		let id = ele.id;
		//card-web-app will catch the card-hovered event no matter where it was
		//thrown from
		this.dispatchEvent(makeCardHoveredEvent(id, e.clientX, e.clientY));
	}

	_recalcGraph() : WebInfoWithLayout {
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
		
		for (var i = 0; i < 300; ++i) simulation.tick();
		return {
			nodes: graph.nodes as WebInfoNodeWithLayout[],
			edges: graph.edges.map(edge => ({source: edge.source as unknown as WebInfoNodeWithLayout, target: edge.target as unknown as  WebInfoNodeWithLayout, value: edge.value})),
		};
	}

	constructor() {
		super();
		this._calculatedGraph = {nodes:[], edges:[]};
	}

	override updated(changedProps : Map<string, any>) {
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
