import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { PropertyValues } from 'lit';

import {
	parseDateSection,
	makeDateSection,
	CONFIGURABLE_FILTER_URL_PARTS,
	isRelativeDate,
	parseRelativeDateParts,
	makeRelativeDateString,
	type RelativeDateType,
	type RelativeDateParts
} from '../filters.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	makeFilterModifiedComplexEvent
} from '../events.js';

import {
	dateRangeType
} from '../types.js';

@customElement('configure-collection-date')
class ConfigureCollectionDate extends LitElement {

	focusPrimaryControl() {
		this.shadowRoot?.querySelector<HTMLElement>(
			'.container input[type="date"], .relative-date-controls input, .relative-date-controls select, .container select'
		)?.focus();
	}

	@property({ type : String })
		value: string;

	@property({ type: Boolean })
		_relativeMode: boolean = false;

	@property({ type: String })
		_relativeType: RelativeDateType = 'offset';

	@property({ type: Number })
		_offsetAmount: number = 3;

	@property({ type: String })
		_offsetUnit: 'day' | 'week' | 'month' | 'year' = 'day';

	@property({ type: String })
		_weekday: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday' = 'monday';

	@property({ type: String })
		_special: 'today' | 'yesterday' = 'yesterday';

	static override styles = [
		ButtonSharedStyles,
		css`
			:host {
				display:inline-block;
			}
			.container {
				display: flex;
				flex-direction: row;
				align-items: center;
				gap: 8px;
				flex-wrap: wrap;
			}
			.mode-selector {
				display: flex;
				flex-direction: row;
				align-items: center;
				gap: 8px;
			}
			.mode-selector label {
				display: flex;
				align-items: center;
				gap: 4px;
				cursor: pointer;
				white-space: nowrap;
			}
			.relative-date-controls {
				display: flex;
				flex-direction: row;
				align-items: center;
				gap: 4px;
				flex-wrap: wrap;
			}
			input[type="number"] {
				width: 60px;
			}
		`
	];

	override willUpdate(changedProperties: PropertyValues) {
		super.willUpdate(changedProperties);

		if (changedProperties.has('value')) {
			// Parse the value to detect if it contains relative dates
			const pieces = this.value.split('/');
			const firstDateStr = pieces[1] || '';

			if (isRelativeDate(firstDateStr)) {
				this._relativeMode = true;
				this._loadRelativeDateParts(firstDateStr);
			} else {
				this._relativeMode = false;
			}
		}
	}

	_loadRelativeDateParts(dateStr: string) {
		const parts = parseRelativeDateParts(dateStr);
		if (!parts) return;

		this._relativeType = parts.type;

		switch (parts.type) {
		case 'offset':
			this._offsetAmount = parts.amount;
			this._offsetUnit = parts.unit;
			break;
		case 'weekday':
			this._weekday = parts.weekday;
			break;
		case 'special':
			this._special = parts.value;
			break;
		}
	}

	override render() {
		const [typ, dateOne, dateTwo] = parseDateSection(this.value);
		const pieces = this.value.split('/');
		const firstDateStr = pieces[1] || '';
		const secondDateStr = pieces[2] || '';

		const typeRequiresSecondDate = CONFIGURABLE_FILTER_URL_PARTS[typ] == 2;

		return html`
			<div class="container">
				<!-- Comparison type selector -->
				<select .value=${typ} @change=${this._handleTypeChanged}>
					${dateRangeType.options.map(t => html`<option .value=${t}>${t}</option>`)}
				</select>

				<!-- Mode selector -->
				<div class="mode-selector">
					<label>
						<input
							type="radio"
							name="mode"
							value="absolute"
							?checked=${!this._relativeMode}
							@change=${this._handleModeChanged}
						>
						Absolute
					</label>
					<label>
						<input
							type="radio"
							name="mode"
							value="relative"
							?checked=${this._relativeMode}
							@change=${this._handleModeChanged}
						>
						Relative
					</label>
				</div>

				<!-- First date input -->
				${this._renderDateInput(true, firstDateStr, dateOne)}

				<!-- Second date input (if needed) -->
				${typeRequiresSecondDate ? this._renderDateInput(false, secondDateStr, dateTwo) : ''}
			</div>
		`;
	}

	_renderDateInput(isFirst: boolean, dateStr: string, dateObj: Date) {
		if (this._relativeMode) {
			return this._renderRelativeDateInput(isFirst, dateStr);
		} else {
			return this._renderAbsoluteDateInput(isFirst, dateObj);
		}
	}

	_renderAbsoluteDateInput(isFirst: boolean, dateObj: Date) {
		const formatted = this._formatDateForInput(dateObj);
		return html`
			<input
				type="date"
				.value=${formatted}
				?data-first=${isFirst}
				@change=${this._handleDateChanged}
			>
		`;
	}

	_renderRelativeDateInput(isFirst: boolean, _dateStr: string) {
		return html`
			<div class="relative-date-controls">
				<!-- Type selector -->
				<select
					.value=${this._relativeType}
					?data-first=${isFirst}
					@change=${this._handleRelativeTypeChanged}
				>
					<option value="offset">Offset</option>
					<option value="weekday">Weekday</option>
					<option value="special">Special</option>
				</select>

				<!-- Controls based on type -->
				${this._relativeType === 'offset' ? html`
					<input
						type="number"
						min="1"
						.value=${String(this._offsetAmount)}
						?data-first=${isFirst}
						@input=${this._handleOffsetAmountChanged}
					>
					<select
						.value=${this._offsetUnit}
						?data-first=${isFirst}
						@change=${this._handleOffsetUnitChanged}
					>
						<option value="day">days</option>
						<option value="week">weeks</option>
						<option value="month">months</option>
						<option value="year">years</option>
					</select>
					<span>ago</span>
				` : ''}

				${this._relativeType === 'weekday' ? html`
					<span>last</span>
					<select
						.value=${this._weekday}
						?data-first=${isFirst}
						@change=${this._handleWeekdayChanged}
					>
						<option value="monday">Monday</option>
						<option value="tuesday">Tuesday</option>
						<option value="wednesday">Wednesday</option>
						<option value="thursday">Thursday</option>
						<option value="friday">Friday</option>
						<option value="saturday">Saturday</option>
						<option value="sunday">Sunday</option>
					</select>
				` : ''}

				${this._relativeType === 'special' ? html`
					<select
						.value=${this._special}
						?data-first=${isFirst}
						@change=${this._handleSpecialChanged}
					>
						<option value="today">Today</option>
						<option value="yesterday">Yesterday</option>
					</select>
				` : ''}
			</div>
		`;
	}

	_dispatchNewValue(newValue : string) {
		this.dispatchEvent(makeFilterModifiedComplexEvent(newValue));
	}

	_formatDateForInput(date: Date): string {
		return date.getFullYear() + '-' +
		       String(date.getMonth() + 1).padStart(2, '0') + '-' +
		       String(date.getDate()).padStart(2, '0');
	}

	_handleModeChanged(e: Event) {
		const ele = e.target as HTMLInputElement;
		this._relativeMode = ele.value === 'relative';

		// When switching to relative mode, initialize with sensible defaults
		if (this._relativeMode) {
			this._emitRelativeDateValue(true);
		} else {
			// When switching to absolute, use the current resolved date
			const [typ, dateOne, dateTwo] = parseDateSection(this.value);
			this._dispatchNewValue(makeDateSection(typ, dateOne, dateTwo));
		}
	}

	_handleTypeChanged(e : Event) {
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLSelectElement)) throw new Error('not select element');
		const [, dateOne, dateTwo] = parseDateSection(this.value);
		const val = dateRangeType.parse(ele.value);

		if (this._relativeMode) {
			// Preserve relative format
			const pieces = this.value.split('/');
			pieces[0] = val;
			this._dispatchNewValue(pieces.join('/'));
		} else {
			this._dispatchNewValue(makeDateSection(val, dateOne, dateTwo));
		}
	}

	_handleDateChanged(e : Event) {
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLInputElement)) throw new Error('not input element');
		let [typ, dateOne, dateTwo] = parseDateSection(this.value);
		const dt = new Date(ele.value);
		if (ele.dataset.first) {
			dateOne = dt;
		} else {
			dateTwo = dt;
		}
		this._dispatchNewValue(makeDateSection(typ, dateOne, dateTwo));
	}

	_handleRelativeTypeChanged(e: Event) {
		const ele = e.target as HTMLSelectElement;
		this._relativeType = ele.value as RelativeDateType;
		const isFirst = (ele as HTMLSelectElement).hasAttribute('data-first');
		this._emitRelativeDateValue(isFirst);
	}

	_handleOffsetAmountChanged(e: Event) {
		const ele = e.target as HTMLInputElement;
		this._offsetAmount = parseInt(ele.value, 10) || 1;
		const isFirst = ele.hasAttribute('data-first');
		this._emitRelativeDateValue(isFirst);
	}

	_handleOffsetUnitChanged(e: Event) {
		const ele = e.target as HTMLSelectElement;
		this._offsetUnit = ele.value as 'day' | 'week' | 'month' | 'year';
		const isFirst = ele.hasAttribute('data-first');
		this._emitRelativeDateValue(isFirst);
	}

	_handleWeekdayChanged(e: Event) {
		const ele = e.target as HTMLSelectElement;
		this._weekday = ele.value as 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
		const isFirst = ele.hasAttribute('data-first');
		this._emitRelativeDateValue(isFirst);
	}

	_handleSpecialChanged(e: Event) {
		const ele = e.target as HTMLSelectElement;
		this._special = ele.value as 'today' | 'yesterday';
		const isFirst = ele.hasAttribute('data-first');
		this._emitRelativeDateValue(isFirst);
	}

	_emitRelativeDateValue(isFirst: boolean) {
		const pieces = this.value.split('/');

		let relativeParts: RelativeDateParts;
		switch (this._relativeType) {
		case 'offset':
			relativeParts = {
				type: 'offset',
				amount: this._offsetAmount,
				unit: this._offsetUnit
			};
			break;
		case 'weekday':
			relativeParts = {
				type: 'weekday',
				weekday: this._weekday
			};
			break;
		case 'special':
			relativeParts = {
				type: 'special',
				value: this._special
			};
			break;
		}

		const relativeStr = makeRelativeDateString(relativeParts);

		if (isFirst) {
			pieces[1] = relativeStr;
		} else {
			pieces[2] = relativeStr;
		}

		this._dispatchNewValue(pieces.join('/'));
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'configure-collection-date': ConfigureCollectionDate;
	}
}
