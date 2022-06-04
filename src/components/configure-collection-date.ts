import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
	parseDateSection,
	makeDateSection,
	DATE_RANGE_TYPES,
	CONFIGURABLE_FILTER_URL_PARTS
} from '../filters.js';

import { ButtonSharedStyles } from './button-shared-styles.js';


@customElement('configure-collection-date')
class ConfigureCollectionDate extends LitElement {

	@property({ type : String })
	value: string;

	static override styles = [
		ButtonSharedStyles,
		css`
			:host {
				display:inline-block;
			}
			div {
				display:flex;
				flex-direction: row;
			}
		`
	];

	override render() {
		const [typ, dateOne, dateTwo] = parseDateSection(this.value);
		const typeRequiresSecondDate = CONFIGURABLE_FILTER_URL_PARTS[typ] == 2;
		return html`
			<div>
				<select .value=${typ} @change=${this._handleTypeChanged}>
					${Object.keys(DATE_RANGE_TYPES).map(typ => html`<option .value=${typ}>${typ}</option>`)}
				</select>
				<input type='date' .value=${dateOne} .index=${0} @change=${this._handleDateChanged}>
				<input type='date' .value=${dateTwo} .index=${1} ?hidden=${!typeRequiresSecondDate} @change=${this._handleDateChanged}>
			</div>
		`;
	}

	_dispatchNewValue(newValue) {
		this.dispatchEvent(new CustomEvent('change-complex', {composed: true, detail: {value: newValue}}));
	}

	_handleTypeChanged(e) {
		const ele = e.composedPath()[0];
		const [, dateOne, dateTwo] = parseDateSection(this.value);
		this._dispatchNewValue(makeDateSection(ele.value, dateOne, dateTwo));
	}

	_handleDateChanged(e) {
		const ele = e.composedPath()[0];
		let [typ, dateOne, dateTwo] = parseDateSection(this.value);
		const dt = new Date(ele.value);
		if (ele.index == 0) {
			dateOne = dt;
		} else {
			dateTwo = dt;
		}
		this._dispatchNewValue(makeDateSection(typ, dateOne, dateTwo));
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'configure-collection-date': ConfigureCollectionDate;
	}
}
