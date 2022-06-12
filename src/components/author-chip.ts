
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { Author } from '../types.js';

@customElement('author-chip')
class AuthorChip extends LitElement {

	@property( { type: Object })
		author : Author;

	static override styles = [
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

	override render() {
		return html`
			<div>
				<img src='${this.author && this.author.photoURL ? this.author.photoURL : '/images/person.svg'}'>
				<span>${this.author && this.author.displayName ? this.author.displayName : 'Unknown user'}</span>
			</div>
			`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'author-chip': AuthorChip;
	}
}
