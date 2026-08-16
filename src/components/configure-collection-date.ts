import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
	parseDateSection,
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

	static override styles = [
		ButtonSharedStyles,
		css`
			:host {
				display:inline-block;
			}
			.container {
				display: flex;
				flex-direction: row;
				align-items: flex-end;
				gap: 8px;
				flex-wrap: wrap;
			}
			.date-boundary {
				border: 0;
				display: flex;
				flex-direction: column;
				gap: 4px;
				margin: 0;
				min-width: 0;
				padding: 0;
			}
			.date-boundary legend {
				color: var(--app-dark-text-color-light);
				font-size: 0.75em;
				padding: 0;
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

	override render() {
		const [typ, dateOne, dateTwo] = parseDateSection(this.value);
		const pieces = this.value.split('/');
		const firstDateStr = pieces[1] || '';
		const secondDateStr = pieces[2] || '';

		const typeRequiresSecondDate = CONFIGURABLE_FILTER_URL_PARTS[typ] == 2;

		return html`
			<div class="container">
				<!-- Comparison type selector -->
				<select aria-label='Date comparison' .value=${typ} @change=${this._handleTypeChanged}>
					${dateRangeType.options.map(t => html`<option .value=${t}>${t[0].toUpperCase() + t.slice(1)}</option>`)}
				</select>

				<!-- First date input -->
				${this._renderDateBoundary(true, firstDateStr, dateOne, typeRequiresSecondDate ? 'Start' : 'Date')}

				<!-- Second date input (if needed) -->
				${typeRequiresSecondDate ? this._renderDateBoundary(false, secondDateStr, dateTwo, 'End') : ''}
			</div>
		`;
	}

	_renderDateBoundary(isFirst: boolean, dateStr: string, dateObj: Date, label: string) {
		const relativeMode = isRelativeDate(dateStr);
		return html`
			<fieldset class="date-boundary">
				<legend>${label}</legend>
				<div class="mode-selector">
					<label>
						<input
							type="radio"
							name=${isFirst ? 'mode-first' : 'mode-second'}
							value="absolute"
							?data-first=${isFirst}
							?checked=${!relativeMode}
							@change=${this._handleModeChanged}
						>
						Fixed date
					</label>
					<label>
						<input
							type="radio"
							name=${isFirst ? 'mode-first' : 'mode-second'}
							value="relative"
							?data-first=${isFirst}
							?checked=${relativeMode}
							@change=${this._handleModeChanged}
						>
						Rolling date
					</label>
				</div>
				${relativeMode ? this._renderRelativeDateInput(isFirst, dateStr) : this._renderAbsoluteDateInput(isFirst, dateStr, dateObj)}
			</fieldset>
		`;
	}

	_renderAbsoluteDateInput(isFirst: boolean, dateStr: string, dateObj: Date) {
		const match = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
		const formatted = match ?
			`${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` :
			this._formatDateForInput(dateObj);
		return html`
			<input
				aria-label=${isFirst ? 'First fixed date' : 'Second fixed date'}
				type="date"
				.value=${formatted}
				?data-first=${isFirst}
				@change=${this._handleDateChanged}
			>
		`;
	}

	_renderRelativeDateInput(isFirst: boolean, dateStr: string) {
		const parts = parseRelativeDateParts(dateStr) || this._defaultRelativeParts('offset', isFirst);
		return html`
			<div class="relative-date-controls">
				<!-- Type selector -->
				<select
					aria-label=${isFirst ? 'First rolling date kind' : 'Second rolling date kind'}
					.value=${parts.type}
					?data-first=${isFirst}
					@change=${this._handleRelativeTypeChanged}
				>
					<option value="offset">A time ago</option>
					<option value="weekday">Previous weekday</option>
					<option value="special">Today or yesterday</option>
				</select>

				<!-- Controls based on type -->
				${parts.type === 'offset' ? html`
					<input
						aria-label=${isFirst ? 'First rolling date amount' : 'Second rolling date amount'}
						type="number"
						min="1"
						.value=${String(parts.amount)}
						?data-first=${isFirst}
						@input=${this._handleOffsetAmountChanged}
					>
					<select
						aria-label=${isFirst ? 'First rolling date unit' : 'Second rolling date unit'}
						.value=${parts.unit}
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

				${parts.type === 'weekday' ? html`
					<span>last</span>
					<select
						aria-label=${isFirst ? 'First rolling weekday' : 'Second rolling weekday'}
						.value=${parts.weekday}
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

				${parts.type === 'special' ? html`
					<select
						aria-label=${isFirst ? 'First rolling special date' : 'Second rolling special date'}
						.value=${parts.value}
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

	_defaultRelativeParts(type: RelativeDateType, isFirst: boolean): RelativeDateParts {
		switch (type) {
		case 'offset':
			return { type: 'offset', amount: 3, unit: 'day' };
		case 'weekday':
			return { type: 'weekday', weekday: 'monday' };
		case 'special':
			return { type: 'special', value: isFirst ? 'yesterday' : 'today' };
		}
	}

	_relativePartsForBoundary(isFirst: boolean, fallbackType: RelativeDateType = 'offset'): RelativeDateParts {
		const pieces = this.value.split('/');
		return parseRelativeDateParts(pieces[isFirst ? 1 : 2] || '') ||
			this._defaultRelativeParts(fallbackType, isFirst);
	}

	_replaceBoundary(isFirst: boolean, dateValue: string) {
		const pieces = this.value.split('/');
		const typ = dateRangeType.parse(pieces[0]);
		const argumentCount = CONFIGURABLE_FILTER_URL_PARTS[typ];
		while (pieces.length < argumentCount + 1) pieces.push('');
		pieces[isFirst ? 1 : 2] = dateValue;
		this._dispatchNewValue(pieces.slice(0, argumentCount + 1).join('/'));
	}

	_handleModeChanged(e: Event) {
		const ele = e.target as HTMLInputElement;
		const isFirst = ele.hasAttribute('data-first');
		if (ele.value === 'relative') {
			const relativeParts = this._relativePartsForBoundary(isFirst);
			this._replaceBoundary(isFirst, makeRelativeDateString(relativeParts));
			return;
		}

		// A rolling boundary still has a concrete meaning today. Preserve that
		// meaning when the user makes just this boundary fixed.
		const [, dateOne, dateTwo] = parseDateSection(this.value);
		this._replaceBoundary(isFirst, this._formatDateForInput(isFirst ? dateOne : dateTwo));
	}

	_handleTypeChanged(e : Event) {
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLSelectElement)) throw new Error('not select element');
		const val = dateRangeType.parse(ele.value);
		const pieces = this.value.split('/');
		pieces[0] = val;
		const argumentCount = CONFIGURABLE_FILTER_URL_PARTS[val];
		if (argumentCount === 2 && !pieces[2]) {
			pieces[2] = isRelativeDate(pieces[1] || '') ?
				'today' : this._formatDateForInput(new Date());
		}
		this._dispatchNewValue(pieces.slice(0, argumentCount + 1).join('/'));
	}

	_handleDateChanged(e : Event) {
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLInputElement)) throw new Error('not input element');
		this._replaceBoundary(ele.hasAttribute('data-first'), ele.value);
	}

	_handleRelativeTypeChanged(e: Event) {
		const ele = e.target as HTMLSelectElement;
		const isFirst = ele.hasAttribute('data-first');
		const parts = this._defaultRelativeParts(ele.value as RelativeDateType, isFirst);
		this._replaceBoundary(isFirst, makeRelativeDateString(parts));
	}

	_handleOffsetAmountChanged(e: Event) {
		const ele = e.target as HTMLInputElement;
		const isFirst = ele.hasAttribute('data-first');
		const current = this._relativePartsForBoundary(isFirst, 'offset');
		const unit = current.type === 'offset' ? current.unit : 'day';
		this._replaceBoundary(isFirst, makeRelativeDateString({
			type: 'offset',
			amount: parseInt(ele.value, 10) || 1,
			unit
		}));
	}

	_handleOffsetUnitChanged(e: Event) {
		const ele = e.target as HTMLSelectElement;
		const isFirst = ele.hasAttribute('data-first');
		const current = this._relativePartsForBoundary(isFirst, 'offset');
		const amount = current.type === 'offset' ? current.amount : 3;
		this._replaceBoundary(isFirst, makeRelativeDateString({
			type: 'offset',
			amount,
			unit: ele.value as 'day' | 'week' | 'month' | 'year'
		}));
	}

	_handleWeekdayChanged(e: Event) {
		const ele = e.target as HTMLSelectElement;
		const isFirst = ele.hasAttribute('data-first');
		this._replaceBoundary(isFirst, makeRelativeDateString({
			type: 'weekday',
			weekday: ele.value as 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'
		}));
	}

	_handleSpecialChanged(e: Event) {
		const ele = e.target as HTMLSelectElement;
		const isFirst = ele.hasAttribute('data-first');
		this._replaceBoundary(isFirst, makeRelativeDateString({
			type: 'special',
			value: ele.value as 'today' | 'yesterday'
		}));
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'configure-collection-date': ConfigureCollectionDate;
	}
}
