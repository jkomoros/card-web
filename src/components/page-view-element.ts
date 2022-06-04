import { LitElement } from 'lit';
import { property } from 'lit/decorators.js';

export class PageViewElement extends LitElement {

	@property({ type: Boolean })
	active : boolean;

	// Only render this page if it's actually visible.
	override shouldUpdate() {
		return this.active;
	}

}
