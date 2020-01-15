import { LitElement, html } from '@polymer/lit-element';

import './card-decorators.js';

import { cardHasContent } from '../util';

// This is a reusable element. It is not connected to the store. You can
// imagine that it could just as well be a third-party element that you
// got from someone else.
class CardThumbnail extends LitElement {
	render() {
		return html`
      <style>

        div.main:hover h3 {
          color: var(--app-secondary-color);
        }

        h3 {
          color: var(--app-dark-text-color);
          text-align:center;
          font-size: 0.8em;
          font-family: var(--app-header-font-family);
        }
        
        h3.nocontent {
          font-style: italic;
        }

        div.main:hover {
          border:2px solid var(--app-secondary-color);
        }

        div.main {
          cursor:pointer;
          padding: 0.5em;
          height: 6em;
          width: 12em;
          overflow:hidden;
          display:flex;
          align-items:center;
          justify-content:center;
          background-color: var(--card-color);
          box-shadow: var(--card-shadow);
          margin:0.5em;
          box-sizing:border-box;
          position:relative;
          border: 2px solid transparent;
        }

        div.unpublished {
          background-color: var(--unpublished-card-color);
        }

        .selected {
          border:2px solid var(--app-primary-color);
        }

        .selected h3 {
          color: var(--app-primary-color);
        }

        div.section-head {
          background-color: var(--app-primary-color);
        }

        div.section-head.selected {
          border: 2px solid var(--app-light-text-color);
        }

        div.section-head h3 {
          color: var(--app-light-text-color);
        }

        div.section-head.selected h3 {
          color: var(--app-primary-color-light);
        }

        div.section-head:hover h3 {
          color: var(--app-primary-color-subtle);
        }

        div.section-head:hover {
          border:2px solid var(--app-primary-color-subtle);
        }

        .empty {
          opacity:0.5;
        }

		.ghost {
			opacity:0.5;
		}

      </style>
      <div @mousemove=${this._handleMouseMove} @click=${this._handleClick} draggable='${this.userMayEdit ? 'true' : 'false'}' class="main ${this.selected ? 'selected' : ''} ${this.cardType} ${this.card && this.card.published ? '' : 'unpublished'} ${this.willBeRemovedOnPendingFilterCommit ? 'ghost' : ''}">
		<h3 class=${this.cardHasContent ? '' : 'nocontent'}>${this.title ? this.title : html`<span class='empty'>[Untitled]</span>`}</h3>
      <card-decorators .card=${this.card} .light=${this.cardType != 'content'}></card-decorators>
      </div>
    `;
	}

	static get properties() { 
		return {
			id: {type: String},
			name: { type:String },
			title: { type: String },
			selected: { type: Boolean },
			cardType: { type: String},
			userMayEdit: {type: Boolean},
			//If the card will be removed on the next filter commit then this should
			//be set, so the item can be rendered with lower opacity.
			willBeRemovedOnPendingFilterCommit: { type:Boolean },
			//Card isn't used for much, except a a place for the container to stash
			//the whole card (for convenience with dragging).
			card: {type: Object},
			_selectedViaClick: { type: Boolean },
		};
	}
  
	get cardHasContent() {
		return cardHasContent(this.card);
	}

	_handleClick(e) {
		e.stopPropagation();
		this._selectedViaClick = true;
		const ctrl = e.ctrlKey || e.metaKey;
		//TODO: ctrl-click on mac shouldn't show the right click menu
		this.dispatchEvent(new CustomEvent('thumbnail-tapped', {composed:true, detail: {card: this.card, ctrl}}));
	}
  
	_handleMouseMove(e) {
		e.stopPropagation();
		let id = this.card ? this.card.id : '';
		//compendium-app will catch the card-hovered event no matter where it was
		//thrown from
		this.dispatchEvent(new CustomEvent('card-hovered', {composed:true, detail: {card: id, x: e.clientX, y: e.clientY}}));
	}

	updated(changedProps) {
		if (changedProps.has('selected') && this.selected) {
			if (!this._selectedViaClick) {
				this.scrollIntoView({behavior:'auto', block:'center', });
			}
			this._selectedViaClick = false;
		}
	}

}

window.customElements.define('card-thumbnail', CardThumbnail);
