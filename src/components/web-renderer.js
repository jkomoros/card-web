import { html, LitElement } from '@polymer/lit-element';

import { repeat } from 'lit-html/directives/repeat';

import '@petitatelier/d3-force-graph';
import 'd3/dist/d3.min.js';

export class WebRenderer extends LitElement {
	render() {
		return html`
		<style>
			:host {
				height:100%;
				width:100%;
			}
		</style>
		<d3-force-graph>
			<svg slot='nodes'>
				${this.webInfo.nodes.length ? repeat(this.webInfo.nodes, o => o.id, o => html`<circle id=${o.id} title=${o.name} r=1></circle>`) : html`<circle id='1'></circle>`}
			</svg>
			<svg slot='links'>
				${this.webInfo.edges.length ? repeat(this.webInfo.edges, o => o.source + o.target, o => html`<link source=${o.source} target=${o.target}></link>`) : html`<link source='1' target='1'></link>`}
			</svg>
		</d3-force-graph>
	`;
	}

	static get properties() {
		return {
			//as returned from e.g. collection.webInfo
			webInfo: {type:Object},
		};
	}

	updated() {
		//The web component doesn't notice that there are new items distributed to it, so tell it to.
		setTimeout(() => this.shadowRoot.querySelector('d3-force-graph').reset(), 0);
	}

}

window.customElements.define('web-renderer', WebRenderer);
