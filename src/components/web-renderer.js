import { html, LitElement, svg } from '@polymer/lit-element';

import * as d3 from 'd3';

export class WebRenderer extends LitElement {
	render() {
		const width = this.offsetWidth;
		const height = this.offsetHeight;
		return html`
		<style>
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
			}
			line {
				stroke:var(--app-dark-text-color-light);
				z-index:0;
			}
		</style>

		<svg viewBox=${'0 0 ' + width + ' ' + height}>
			${this._calculatedGraph.edges.map(node => svg`<line x1=${node.source.x} x2=${node.target.x} y1=${node.source.y} y2=${node.target.y} stroke-width='1'></line>`)}	
			${this._calculatedGraph.nodes.map(node => svg`<circle id=${node.id} title=${node.name} r='4' cx=${node.x} cy=${node.y}></circle>`)}
		</svg>
	`;
	}

	static get properties() {
		return {
			//as returned from e.g. collection.webInfo
			webInfo: {type:Object},
			_calculatedGraph : { type:Object }
		};
	}

	_recalcGraph() {
		//Make a deep copy of the graph, because d3 will operate on it.
		const graph = {...this.webInfo};
		if (Object.keys(graph).length == 0) return {nodes:[], edges:[]};
		graph.nodes = [...graph.nodes];
		graph.edges = [...graph.edges];

		//It's gnarly to have this layout-dependent thing in here
		const width = this.offsetWidth;
		const height = this.offsetHeight;

		const simulation = d3.forceSimulation(graph.nodes)
			.force('link', d3.forceLink().id(d => d.id))
			.force('charge', d3.forceManyBody())
			.force('center', d3.forceCenter(width / 2, height / 2))
			.stop();
		
		simulation.force('link')
			.links(graph.edges);
		
		for (var i = 0; i < 300; ++i) simulation.tick();

		return graph;
	}

	constructor() {
		super();
		this._calculatedGraph = {nodes:[], edges:[]};
	}

	updated(changedProps) {
		if (changedProps.has('webInfo')) {
			this._calculatedGraph = this._recalcGraph();
		}
	}

}

window.customElements.define('web-renderer', WebRenderer);
