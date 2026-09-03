import { css } from 'lit';

export const SharedStyles = css`
	:host {
		display: block;
		box-sizing: border-box;
	}

	h2 {
		font-size: 24px;
		text-align: center;
		color: var(--app-dark-text-color);
	}

	[hidden] {
		display:none !important;
	}

	/* Text that exists for assistive tech only — a live region announcing a
	   change the sighted user can already see, a name for a control whose label
	   is a glyph. NOT display:none or visibility:hidden: both remove it from the
	   accessibility tree, which is the entire point of the element.

	   Here because it is the fourth copy of this exact rule in the codebase and
	   the first one in a shared stylesheet. The other three
	   (snack-bar's, dialog-element's .focus-sentinel, corpus-status-indicator's
	   .label) each carry local overrides that have to be untangled one at a
	   time; new code should take this one rather than adding a fifth. */
	.visually-hidden {
		clip: rect(0 0 0 0);
		clip-path: inset(50%);
		height: 1px;
		overflow: hidden;
		position: absolute;
		white-space: nowrap;
		width: 1px;
	}

	a {
		color: var(--app-primary-color);
	}

	a:visited {
		color: var(--app-primary-color-light);
	}

	a[card] {
		color: var(--app-secondary-color);
	}

	a[card]:visited {
		color: var(--app-secondary-color-light);
	}

	.circle {
		display: block;
		width: 64px;
		height: 64px;
		margin: 0 auto;
		text-align: center;
		border-radius: 50%;
		background: var(--app-primary-color);
		color: var(--app-light-text-color);
		font-size: 30px;
		line-height: 64px;
	}
`;
