
import { LitElement, html, css } from 'lit';

class AuthorChip extends LitElement {

	static styles = [
		css`
			div {
				display:flex;
				align-items:center;
			}
			img {
				--user-image-size: 20px;
				height:var(--user-image-size);
				width: var(--user-image-size);
				border-radius:calc(var(--user-image-size) / 2);
				margin-right: calc(var(--user-image-size) / 4);
				background-color: var(--app-dark-text-color-subtle);
				cursor:pointer;
			}
			span {
				color: var(--app-dark-text-color);
			}
		`
	];

	render() {
		return html`
			<div>
				<img src='${this.author && this.author.photoURL ? this.author.photoURL : '/images/person.svg'}'>
				<span>${this.author && this.author.displayName ? this.author.displayName : 'Unknown user'}</span>
			</div>
			`;
	}

	static get properties() {
		return {
			author: { type: Object },
		};
	}
}

window.customElements.define('author-chip', AuthorChip);
