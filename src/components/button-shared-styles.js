import { css } from 'lit';

export const ButtonSharedStyles = css`
	button {
		font-size: inherit;
		vertical-align: middle;
		color: var(--app-light-text-color);
		background: var(--app-dark-text-color);
		padding: 0.5em;
		box-shadow: 0 2px 2px var(--shadow-color);
		border: none;
		cursor: pointer;
		margin: 0.5em;
		position: relative;
		overflow: hidden;
		transition: background-color var(--transition-fade), color var(--transition-fade), box-shadow var(--transition-fade);
	}
	button:disabled, button.need-signin {
		cursor:default;
		background-color: var(--app-dark-text-color-light);
	}

	button:focus {
		outline:none;
	}

	button.primary {
		background: var(--app-primary-color);
	}
	button.primary.selected {
		background: var(--app-primary-color-light);
	}
	button.primary:disabled {
		background-color: var(--app-dark-text-color-light);
	}
	button.selected {
		background: var(--app-secondary-color-light);
	}
	button.round {
		border-radius:50%;
		height: 2.75em;
		width: 2.75em;
	}
	button svg {
		fill: var(--app-light-text-color);
	}
	button:hover {
		box-shadow: 0 6px 6px var(--shadow-color);
		background: var(--app-secondary-color);
	}
	button:disabled:hover, button.need-signin:hover {
		/* Basically manually undo the hover styles if the button is disabled */
		box-shadow: 0 2px 2px var(--shadow-color);
		background-color: var(--app-dark-text-color-light);
	}

	button.small:disabled svg, button.small.need-signin svg {
		fill: var(--app-dark-text-color-light);
	}

	button.small {
		background:transparent;
		padding: 0;
		margin:0;
		box-shadow: none;
	}

	button.small svg {
		fill: var(--app-dark-text-color);
		height:18px;
		width:18px;
	}

	button.small:hover svg {
		fill: var(--app-dark-text-color-light);
		box-shadow:none;
		padding:0;
	}

	label {
		font-size:0.75em;
		color: var(--app-dark-text-color-light);
		font-weight:normal;
		margin:0;
		margin-top:1em;
	}
`;
