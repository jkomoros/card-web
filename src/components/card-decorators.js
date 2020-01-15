import { LitElement, html } from '@polymer/lit-element';

import './star-count.js';
import './read-decorator.js';
import './thread-count.js';
import './reading-list-decorator.js';
import './todo-decorator.js';

//CardDecorators is designed to be included in a card-like object and
//automatically put the applicable badges into the various corners.
class CardDecorators extends LitElement {
	render() {
		return html`
      <style>

		:host {
			position:absolute;
			top: 0;
			left: 0;
			height: 100%;
			width: 100%;
		}

        .top-right {
          position:absolute;
          top: 0.25em;
          right: 0.25em;
		  display: flex;
        }

        read-decorator {
          position:absolute;
          left: 0.25em;
          top: 0.25em;
        }

        thread-count {
          position:absolute;
          bottom:0.25em;
          right: 0.25em;
        }

        reading-list-decorator {
          position: absolute;
          bottom:0.25em;
          left: 0.25em;
        }

      </style>
      <div class='top-right'>
        <star-count .count=${this.card.star_count || 0} .highlighted=${this.starred} .light=${this.light}></star-count>		
        <todo-decorator .visible=${this.hasTodo} .light=${this.light}></todo-decorator>
      </div>
      <read-decorator .visible=${this.read} .light=${this.light}></read-decorator>
      <thread-count .count=${this.card.thread_count || 0} .light=${this.light}></thread-count>
      <reading-list-decorator .visible=${this.onReadingList} .light=${this.light}></reading-list-decorator>
    `;
	}

	static get properties() { 
		return {
			//If a light theme shpould be used
			light: { type: Boolean },
			card: {type: Object},
			starred: {type:Boolean},
			read: {type:Boolean},
			hasTodo: {type:Boolean},
			onReadingList: {type:Boolean},
		};
	}

}

window.customElements.define('card-decorators', CardDecorators);
