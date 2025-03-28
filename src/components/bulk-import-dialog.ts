import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { DialogElement } from './dialog-element.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	closeBulkImportDialog,
	commitBulkImport,
	processBulkImportContent,
	semanticSortExport
} from '../actions/bulk-import.js';

import {
	CHECK_CIRCLE_OUTLINE_ICON,
	COPY_ALL_ICON,
	SHUFFLE_ICON
} from '../../shared/icons.js';

import {
	selectBulKimportDialogMode,
	selectBulkImportDialogBodies,
	selectBulkImportDialogExportContent,
	selectBulkImportDialogOpen,
	selectBulkImportPending,
	selectUserMayUseAI
} from '../selectors.js';

import {
	BulkImportDialogMode,
	State,
} from '../types.js';

import {
	assertUnreachable
} from '../../shared/util.js';

import bulkImport from '../reducers/bulk-import.js';
store.addReducers({
	bulkImport
});

@customElement('bulk-import-dialog')
class BulkImportDialog extends connect(store)(DialogElement) {

	@state()
		_bodies: string[];

	@state()
		_pending : boolean;

	
	@state()
		_mode : BulkImportDialogMode = 'import';

	@state()
		_exportContent : string;

	@state()
		_exportNode : HTMLElement | null = null;

	@state()
		_aiEnabled : boolean;

	static override styles = [
		...DialogElement.styles,
		ButtonSharedStyles,
		css`

			.scrim {
				z-index:100;
				height:100%;
				width:100%;
				position:absolute;
				background-color:rgba(255,255,255,0.7);
				display:none;
			}

			.pending .scrim {
				display:block;
			}

			textarea {
				flex-grow:1;
				width:100%;
				height:5em;
			}

			.buttons {
				display:flex;
				flex-direction: row;
				justify-content:flex-end;
			}

			.output p {
				margin: 0;
			}
		`
	];

	private innerRenderImport() {
		return html`
			${this._bodies.length ?
		html`<p>Verify these bodies are ones you want to create!</p>
			${this._bodies.map((body) => html`<textarea disabled .value=${body}></textarea>`)}` :
		html`<input type='checkbox' id='bulleted' .checked=${false}><label for='bulleted'>Maintain list formatting</label><br />
			<p>Paste Google Docs bullets here to import them</p>
			<textarea
				id='input'
				@paste=${this._handleRawPaste}
				placeholder='Paste html here'></textarea>`
}
			<div class='buttons'>
				<button
					class='round'
					?disabled=${!this._bodies.length}
					@click='${this._handleDoneClicked}'
				>
					${CHECK_CIRCLE_OUTLINE_ICON}
				</button>
			</div>`;
	}

	private innerRenderExport() {
		//TODO: render as selectable HTML
		return html`<div>
			<button	
				class='small'
				@click=${this._handleSemanticSortClicked}
				?disabled=${!this._aiEnabled}
				id='semantic-sort'
			>${SHUFFLE_ICON}</button>
			<label for='semantic-sort'>Semantic Sort</label>
			<button
				class='small'
				id='copy'
				@click=${this.copyExportedContent}
			>${COPY_ALL_ICON}</button>
			<label for='copy'>Copy</label>
			<p>Copy this content to import it elsewhere:</p>
			<div class='output'>
				${unsafeHTML(this._exportContent)}
			</div>
		</div>`;
	}

	override innerRender() {
		let content = html``;
		if (!this.open) return html``;
		switch (this._mode) {
		case 'import':
			content = this.innerRenderImport();
			break;
		case 'export':
			content = this.innerRenderExport();
			break;
		default:
			return assertUnreachable(this._mode);
		}
		return html`<div class='${this._pending ? 'pending' : ''}'>
			<div class='scrim'></div>
			${content}
		</div>`;
	}

	_handleRawPaste(e : ClipboardEvent) {
		e.preventDefault();
		const clipboardData = e.clipboardData;
		if (!clipboardData) throw new Error('No clipboardData');
		const pastedData = clipboardData.getData('text/html');
		const target = e.target;
		if (!target) throw new Error('No target');
		if (!(target instanceof HTMLTextAreaElement)) throw new Error('target not textarea');
		const checkbox = this.shadowRoot?.querySelector('input#bulleted') as HTMLInputElement | null;
		//TODO: it's weird that this state is maintained not in actual state but just in the component itself.
		if (!checkbox) throw new Error('No checkbox');
		store.dispatch(processBulkImportContent(pastedData, !checkbox.checked));
	}

	_handleSemanticSortClicked() {
		store.dispatch(semanticSortExport());
	}

	_handleDoneClicked() {
		store.dispatch(commitBulkImport());
	}

	override _shouldClose() {
		//Override base class.
		store.dispatch(closeBulkImportDialog());
	}

	override stateChanged(state : State) {
		//tODO: it's weird that we manually set our superclasses' public property
		this.open = selectBulkImportDialogOpen(state);
		this._bodies = selectBulkImportDialogBodies(state);
		this._pending = selectBulkImportPending(state);
		this._mode = selectBulKimportDialogMode(state);
		this._exportContent = selectBulkImportDialogExportContent(state);
		this._aiEnabled = selectUserMayUseAI(state);
		this.title = 'Bulk ' + (this._mode === 'import' ? 'Import' : 'Export');
	}

	copyExportedContent() {
		navigator.clipboard.write([
			new ClipboardItem({
				'text/html': new Blob([this._exportContent], {type: 'text/html'}),
			}),
		]);
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'bulk-import-dialog': BulkImportDialog;
	}
}
