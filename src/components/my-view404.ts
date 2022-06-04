import { html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { PageViewElement } from './page-view-element.js';

// These are the shared styles needed by this element.
import { SharedStyles } from './shared-styles.js';

@customElement('my-view404')
class MyView404 extends PageViewElement {

	static override styles = [
		SharedStyles,
	];

	override render() {
		return html`
			<section>
				<h2>Oops! You hit a 404</h2>
				<p>The page you're looking for doesn't seem to exist. Head back
					<a href="/">home</a> and try again?
				</p>
			</section>
    `;
	}
}

declare global {
	interface HTMLElementTagNameMap {
	  'my-view404': MyView404;
	}
}
