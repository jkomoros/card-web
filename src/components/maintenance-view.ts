import { html, css, TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
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
	MaintenanceTaskDefinition,
} from '../actions/maintenance.js';

// These are the shared styles needed by this element.
import { SharedStyles } from './shared-styles.js';
//We include a hidden card-stage because it provides teh sizingCardRenderer so
//the maintence task update-font-size-boost can work
import './card-stage.js';

import {
	State,
	MaintenanceTaskMap,
	MaintenanceTaskID
} from '../types.js';

@customElement('maintenance-view')
class MaintenanceView extends connect(store)(PageViewElement) {

	@state()
		_isAdmin: boolean;

	@state()
		_executedTasks: MaintenanceTaskMap;

	@state()
		_nextTaskName: MaintenanceTaskID;

	@state()
		_taskActive: boolean;

	static override styles = [
		SharedStyles,
		css`
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
		`
	];

	override render() {
		return html`
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
			${repeat(Object.keys(MAINTENANCE_TASKS).filter(key => !(this._executedTasks || {})[key]), (item) => item, (item) => this._buttonForTaskName(item))}
		  </details>
        </section>
		<card-stage style='visibility:hidden;z-index:-100;position:absolute'></card-stage>
      </section>
    `;
	}

	_buttonForTaskName(taskName : MaintenanceTaskID) : TemplateResult {
		if (!taskName) return html`<em>No tasks to run</em>`;
		const config = MAINTENANCE_TASKS[taskName];
		let disabled = false;
		if (!config.recurring && this._executedTasks[taskName]) disabled = true;
		const displayName = config.displayName || taskName;
		return html`<button value=${taskName} @click=${this._handleClick} .disabled=${disabled}>${displayName}</button>`;
	}

	get _nextTaskConfig() : MaintenanceTaskDefinition {
		return MAINTENANCE_TASKS[this._nextTaskName];
	}

	override connectedCallback() {
		super.connectedCallback();
		connectLiveExecutedMaintenanceTasks();
	}

	override stateChanged(state : State) {
		this._isAdmin = selectUserIsAdmin(state);
		this._executedTasks = selectExecutedMaintenanceTasks(state);
		this._nextTaskName = selectNextMaintenanceTaskName(state);
		this._taskActive = selectMaintenanceTaskActive(state);
	}

	_runTask(taskName : MaintenanceTaskID) {
		const taskConfig = MAINTENANCE_TASKS[taskName];
		if (!taskConfig) throw new Error('No such task');
		store.dispatch(taskConfig.actionCreator());
	}

	_handleClick(e : Event) {
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLButtonElement)) throw new Error('not button ele');
		this._runTask(ele.value);
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'maintenance-view': MaintenanceView;
	}
}
