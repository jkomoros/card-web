import { css } from 'lit';

export const ButtonSharedStyles = css`
	/* A wrapper for a control that may be DISABLED. Chrome and Safari suppress
	   hover events on disabled controls, so a title on the button itself is
	   unreachable exactly when it is most needed — putting it on the wrapper
	   keeps the explanation available. Lives here so every component gets the
	   same behavior instead of three of them redefining it and two forgetting. */
	span.reason {
		display: inline-flex;
		vertical-align: middle;
	}

	span.reason[hidden] {
		display: none;
	}

	button {
		/* font, not just font-size: without the family a button falls back to
		   the UA default and rendered in Arial beside Source Sans Pro. The
		   banners patched this locally with their own font shorthand; it
		   belongs here. (No backticks: tagged template.) */
		font: inherit;
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

	/* IRREVERSIBLE actions only — deleting a card or a comment, discarding a
	   draft, stopping an operation. Reversible-until-Save removals (a tag, a
	   reference, a filter) stay the plain subtle icon on purpose: colouring
	   those too is what teaches people to stop reading the red ones.
	   Generalized from the save pill's Stop control, which was the app's only
	   visually distinct destructive control. */
	button.small.destructive svg {
		fill: var(--app-warning-color);
	}

	button.small.destructive:hover svg {
		fill: var(--app-warning-color-light);
	}

	button.small.destructive:disabled svg, button.small.destructive.need-signin svg {
		fill: var(--app-dark-text-color-light);
	}

	/* TEXT BUTTON — §4.2's named variant, for banners and gates "where a verb is
	   clearer than a glyph". It was hand-rolled in card-web-app and again in
	   snack-bar, and both copies existed mostly to UNDO the base treatment's
	   margin and drop shadows. Here once instead. */
	button.text {
		flex-shrink: 0;
		border: 0;
		border-radius: 0.3rem;
		margin: 0;
		box-shadow: none;
		padding: 0.4rem 0.6rem;
		background: var(--app-primary-color);
		color: var(--app-light-text-color);
	}

	button.text:hover {
		box-shadow: none;
	}

	button.text[disabled], button.text:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	/* button:disabled:hover from the base rule otherwise outranks this and flips
	   a disabled purple button to grey under the cursor, which reads as broken. */
	button.text:disabled:hover {
		background: var(--app-primary-color);
		box-shadow: none;
	}

	/* DISCARD — the low-emphasis companion to a text button: dismissing an error
	   or discarding a draft should recede, not compete. box-shadow:none is
	   load-bearing, or the base rule's shadows box the link. */
	button.discard {
		flex-shrink: 0;
		margin: 0;
		padding: 0.4rem 0.6rem;
		background: transparent;
		color: inherit;
		box-shadow: none;
		text-decoration: underline;
	}

	button.discard:hover {
		background: transparent;
		box-shadow: none;
	}

	/* These banners hold the app's ONLY recovery controls, and a keyboard user
	   must be able to see which of two adjacent buttons — one destructive — is
	   focused. ButtonSharedStyles strips the UA ring app-wide. */
	button.text:focus-visible, button.discard:focus-visible {
		outline: 2px solid var(--app-primary-color);
		outline-offset: 2px;
	}

	label {
		font-size:0.75em;
		color: var(--app-dark-text-color-light);
		font-weight:normal;
		margin:0;
		margin-top:1em;
		cursor: pointer;
	}
`;
