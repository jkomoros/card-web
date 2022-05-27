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
