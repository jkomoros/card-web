import { html } from '@polymer/lit-element';
import { PageViewElement } from './page-view-element.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import recent from '../reducers/recent.js';
store.addReducers({
	recent
});

import {
	fetchRecentChanges 
} from '../actions/recent.js';

import {
	navigateToChangesNumDays,
	urlForCard
} from '../actions/app.js';

// These are the shared styles needed by this element.
import { SharedStyles } from './shared-styles.js';

class RecentChangesView extends connect(store)(PageViewElement) {
	render() {
		return html`
      ${SharedStyles}
      <style>
        :host {
          overflow:scroll;
          height:100%;
          width:100%;
          padding:2em;
        }
        .container.fetching {
          opacity:0.5;
        }
        h3 {
          margin-bottom:0;
          color: var(--app-secondary-color);
        }
        h4 {
          margin-top:0;
          margin-bottom:0;
          color: var(--app-dark-text-color);
        }
        h4 span {
          color: var(--app-primary-color);
        }
        ul {
          margin:0;
          margin-bottom: 1em;
        }
      </style>
      <h2>Recent Changes</h2>
      <label>Number of Days to Show</label>
      <select @change='${this._handleNumDaysChanged}'>
        <option value='1' ?selected='${this._numDays == 1}'>Last Day</option>
        <option value='7' ?selected='${this._numDays == 7}'>Last Week</option>
        <option value='30' ?selected='${this._numDays == 30}'>Last Month</option>
        <option value='90' ?selected='${this._numDays == 90}'>Last Three Months</option>
        <option value='365' ?selected='${this._numDays == 365}'>Last Year</option>
        <option value='300000000' ?selected='${this._numDays == 300000000}'>Forever</option>
      </select>
      <div class='container ${this._fetching ? 'fetching' : ''}'>
        ${this._renderChanges()}
      </div>
    `;
	}

	_renderChanges() {
		let daysBySection = {};
		Object.entries(this._sections).forEach(info => {
			daysBySection[info[1].title] = this._changesForSection(info[0]);
		});

		let dayKeysInOrder = [];

		for (let sectionDay of Object.values(daysBySection)) {
			dayKeysInOrder = this._mergeSortedArrays(dayKeysInOrder, Object.keys(sectionDay));
		}

		return dayKeysInOrder.map(day => this._changesForDay(day, daysBySection));

	}

	_changesForDay(day, sections) {
		let items  = [];

		for (let section of Object.keys(sections)) {
			let dayItems = sections[section][day];
			if (!dayItems) continue;
			items.push(html`<h4><em>New and updated in</em> <span>${section}</span></h4><ul>${dayItems}</ul>`);
		}


		return html`<h3>${day}</h3>${items}`;
	}

	_mergeSortedArrays(left, right) {
		let a = left.slice();
		let b = right.slice();
		var result = [];
		while(a.length || b.length) {
			if(typeof a[0] === 'undefined') {
				result.push(b[0]);
				b.splice(0,1);
			} else if(new Date(a[0]) < new Date(b[0])){
				result.push(b[0]);
				b.splice(0,1);
			} else {
				result.push(a[0]);
				a.splice(0,1);
			}
		}
		return this._unique(result);
	}

	_unique(sortedArray) {
		//Assuming a sorted array, returns an array like this one but with only one of each unique key;
		let result = [];
		let lastItem = null;
		for (let item of sortedArray) {
			if (lastItem == item) {
				continue;
			}
			lastItem = item;
			result.push(item);
		}
		return result;
	}

	_changesForSection(sectionName) {
		const items = this._cardsBySection[sectionName];
		if (!items) {
			return {};
		}
		let sections = {};
		let currentDate = this._prettyDate(items[0]);
		let currentSection = [];
		sections[currentDate] = currentSection;

		for (let item of Object.values(items)) {
			let prettyDate = this._prettyDate(item);
			if (prettyDate != currentDate) {
				currentSection = [];
				currentDate = prettyDate;
				sections[currentDate] = currentSection;
			}
			let result = html`<li><a card='${item.id}' href='${urlForCard(item.id)}'>${item.title ? item.title : html`<em>Untitled</em>`}</a><em></li>`;
			currentSection.push(result);
		}

		return sections;
	}

	_handleNumDaysChanged(e) {
		let ele = e.composedPath()[0];
		store.dispatch(navigateToChangesNumDays(parseInt(ele.value)));
	}

	_prettyDate(item) {
		let timestamp = item.updated_substantive;
		var d = timestamp.toDate();
		return d.toDateString();
	}

	extractPageExtra(pageExtra) {
		let parts = pageExtra.split('/');
		if (parts.length < 2) {
			return -1;
		}
		if (parts[1].toLowerCase(0)!='days') {
			return -1;
		}
		return parseInt(parts[0]);
	}

	static get properties() {
		return {
			_numDays: {type: Number},
			_cardsBySection: {type: Object},
			_sections: { type:Object },
			_fetching: {type:Boolean}
		};
	}

	stateChanged(state) {
		this._numDays = this.extractPageExtra(state.app.pageExtra);
		this._cardsBySection = state.recent.cardsBySection;
		this._sections = state.data.sections;
		this._fetching = state.recent.fetching;
	}

	updated(changedProps) {
		if(changedProps.has('_numDays')) {
			if (this._numDays < 0) {
				store.dispatch(navigateToChangesNumDays(7));
			} else {
				store.dispatch(fetchRecentChanges(this._numDays));
			}
		}
	}


}

window.customElements.define('recent-changes-view', RecentChangesView);
