import { html } from 'lit';
import { PageViewElement } from './page-view-element.js';
import { connect } from 'pwa-helpers/connect-mixin.js';
import { repeat } from 'lit/directives/repeat.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

// We are lazy loading its reducer.
import maintenance from '../reducers/maintenance.js';
store.addReducers({
	maintenance,
});

import { 
	selectUserIsAdmin,
	selectExecutedMaintenanceTasks,
	selectNextMaintenanceTaskName,
	selectMaintenanceTaskActive
} from '../selectors.js';

import {
	connectLiveExecutedMaintenanceTasks,
	MAINTENANCE_TASKS,
} from '../actions/maintenance.js';

// These are the shared styles needed by this element.
import { SharedStyles } from './shared-styles.js';
//We include a hidden card-stage because it provides teh sizingCardRenderer so
//the maintence task update-font-size-boost can work
import './card-stage.js';

class MaintenanceView extends connect(store)(PageViewElement) {
	render() {
		return html`
	  ${SharedStyles}
	  <style>
	  	.primary {
			  text-align:center;
			  font-size: 2.0em;
		  }

		  .primary button {
			padding:0.5em;
			font-size: 0.7em;
			cursor: pointer;
		  }

		  .primary p {
			  font-size: 0.7em;
			  color: var(--app-dark-text-color-light);
			  font-style: italic;
		  }

		  h4, h5 {
			  margin: 0;
		  }

		  h5 {
			  color: var(--app-dark-text-color-light);
		  }

		.scrim {
			display:none;
			background-color:rgba(0,0,0,0.25);
			z-index:1;
			height:100%;
			width:100%;
			position:absolute;
			text-align:center;
			justify-content:center;
			align-items: center;
		  }

		  .active .scrim {
			  display:flex;
		  }

		  @keyframes pulse {
			  from {
				color: var(--app-dark-text-color);
			  }
			  to {
				color: var(--app-dark-text-color-light);
			  }
		  }

		.scrim div {
			animation-name: pulse;
			animation-duration: 1s;
			animation-direction: alternate;
			animation-iteration-count: infinite;
		}

	  </style>
      <section class='${this._taskActive ? 'active' : ''}'>
		<div class='scrim'>
			<div>
				<h1>Processing...</h1>
				<h4>(This can take some time, see the console for more information)</h4>
			</div>
		</div>
        <h2>Maintenance</h2>
        <p>This page is where maintenance can be done.</p>
        <section ?hidden=${this._isAdmin}>
          <p>You aren't an admin, so nothing is available here.</p>
        </section>
        <section ?hidden=${!this._isAdmin}>
          <p>You're an admin!</p>
		  <div class='primary'>
			<h2>Next task to run: </h2>
			${this._buttonForTaskName(this._nextTaskName)}
		  </div>
		  <br />
		  <br />
		  <br />
		  <h4>Recurring tasks</h4>
		  <h5>disabled ones need maintenance mode to be enabled via 'gulp turn-maintenance-mode-on'</h5>
		  ${repeat(Object.entries(MAINTENANCE_TASKS).filter(entry => entry[1].recurring).map(entry => entry[0]), (item) => item, (item) => this._buttonForTaskName(item))}
		  <p>Tasks that have already been run: ${[...Object.keys(this._executedTasks)].join(', ')}</p>
		  <details>
			<summary>Advanced</summary>
			<h4>Tasks that have not yet been run</h4>
			<h5>You should almost always only run the next task that you're told to, not do it from here</h5>
			${repeat(Object.keys(MAINTENANCE_TASKS).filter(key => !(this._existingTasks || {})[key]), (item) => item, (item) => this._buttonForTaskName(item))}
		  </details>
        </section>
		<card-stage style='visibility:hidden;z-index:-100;position:absolute'></card-stage>
      </section>
    `;
	}

	_buttonForTaskName(taskName) {
		if (!taskName) return html`<em>No tasks to run</em>`;
		const config = MAINTENANCE_TASKS[taskName] || {};
		let disabled = false;
		if (!config.recurring && this._executedTasks[taskName]) disabled = true;
		const displayName = config.displayName || taskName;
		return html`<button value=${taskName} @click=${this._handleClick} .disabled=${disabled}>${displayName}</button>`;
	}

	static get properties() {
		return {
			_isAdmin: { type: Boolean},
			_executedTasks: { type:Object},
			_nextTaskName: { type:String},
			_taskActive: {type:Boolean},
		};
	}

	get _nextTaskConfig() {
		return MAINTENANCE_TASKS[this._nextTaskName] || {};
	}

	connectedCallback() {
		super.connectedCallback();
		connectLiveExecutedMaintenanceTasks();
	}

	stateChanged(state) {
		this._isAdmin = selectUserIsAdmin(state);
		this._executedTasks = selectExecutedMaintenanceTasks(state);
		this._nextTaskName = selectNextMaintenanceTaskName(state);
		this._taskActive = selectMaintenanceTaskActive(state);
	}

	_runTask(taskName) {
		const taskConfig = MAINTENANCE_TASKS[taskName];
		if (!taskConfig) throw new Error('No such task');
		store.dispatch(taskConfig.actionCreator());
	}

	_handleClick(e) {
		let ele = e.composedPath()[0];
		this._runTask(ele.value);
	}

}

window.customElements.define('maintenance-view', MaintenanceView);
