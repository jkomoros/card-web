import { html } from '@polymer/lit-element';
import { PageViewElement } from './page-view-element.js';
import { connect } from 'pwa-helpers/connect-mixin.js';
import { repeat } from 'lit-html/directives/repeat';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { 
	selectUserIsAdmin,
	selectMaintenanceModeEnabled
} from '../selectors.js';

import {
	MAINTENANCE_TASKS,
	INITIAL_SET_UP_TASK_NAME,
	NORMAL_MAINTENANCE_TASK_NAMES,
	MAINTENANCE_MODE_MAINTENANCE_TASK_NAMES,
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
      <section>
        <h2>Maintenance</h2>
        <p>This page is where maintenance can be done.</p>
        <section ?hidden=${this._isAdmin}>
          <p>You aren't an admin, so nothing is available here.</p>
        </section>
        <section ?hidden=${!this._isAdmin}>
          <p>You're an admin!</p>
		  <button @click='${this._handleInitialSetUp}'>Initial SetUp</button>
		  <br />
		  <br />
		  <br />
          ${repeat(NORMAL_MAINTENANCE_TASK_NAMES, (item) => item, (item) => html`
              <button value="${item}" @click='${this._handleClick}'>${item}</button>
		  `)}
		  <br />
		  <h5>Tasks that require maintence mode to be enabled via 'gulp turn-maintenance-mode-on'</h5>
		  ${repeat(MAINTENANCE_MODE_MAINTENANCE_TASK_NAMES, (item) => item, (item) => html`
              <button value="${item}" @click='${this._handleClick}' .disabled=${!this._maintenanceModeEnabled}>${item}</button>
          `)}
        </section>
		<card-stage style='visibility:hidden;z-index:-100;position:absolute'></card-stage>
      </section>
    `;
	}

	static get properties() {
		return {
			_isAdmin: { type: Boolean},
			_maintenanceModeEnabled: { type: Boolean},
		};
	}

	stateChanged(state) {
		this._isAdmin = selectUserIsAdmin(state);
		this._maintenanceModeEnabled = selectMaintenanceModeEnabled(state);
	}

	_handleInitialSetUp() {
		this._runTask(INITIAL_SET_UP_TASK_NAME);
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
