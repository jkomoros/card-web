import { html, css, TemplateResult } from 'lit';

import {
	PLAYLISLT_ADD_CHECK_ICON,
	FORUM_ICON,
	VISIBILITY_ICON,
	ASSIGNMENT_TURNED_IN_ICON,
	STAR_ICON,
	COPY_ALL_ICON
} from './my-icons.js';

import {
	references
} from '../references.js';

import {
	BadgeMap,
	OptionalFieldsCard
} from '../types.js';

type BadgeName = string;

const badge = (name : BadgeName, icon : TemplateResult, countOrVisible : boolean | number, highlighted? : boolean) => {
	const text = typeof countOrVisible == 'number' ? countOrVisible : '';
	return html`<div class='badge ${name} ${highlighted ? 'highlighted' : ''}' ?hidden=${!countOrVisible}><div>${icon}${text}</div></div>`;
};

//if you use starBadge, also print out badgeStyles within your component's shadowDOM.
export const starBadge = (count : number, highlighted? : boolean) => {
	return badge('star-count', STAR_ICON, count, highlighted);
};

export const badgeStyles =  css`
	.badge {
			display:block;
			font-size:0.8em;
	}

	.badge[hidden] {
		display:none;
	}

		.badge > div {
			display:flex;
			flex-direction:row;
			align-items:center;
			color: var(--app-dark-text-color-light);
		}

		.light {
			color: var(--app-light-text-color);
		}

		.badge.highlighted {
			color: var(--app-primary-color-subtle);
		}

		.light .badge.highlighted {
			color: var(--app-primary-color-light);
		}

		.badge svg {
			height: 1em;
			width: 1em;
			fill: var(--app-dark-text-color-light);
		}

		.light svg {
			fill: var(--app-light-text-color);
		}

		.badge.highlighted svg {
			fill: var(--app-primary-color-subtle);
		}

		.light .badge.highlighted {
			fill: var(--app-primary-color-light);
		}
`;

export const cardBadgesStyles = css`
	.badges-container {
		position:absolute;
		top: 0;
		left: 0;
		height: 100%;
		width: 100%;
	}

	.badges-container .top-right {
		position:absolute;
		top: 0.25em;
		right: 0.25em;
		display: flex;
	}

	.badges-container .read {
		position:absolute;
		left: 0.25em;
		top: 0.25em;
	}

	.badges-container .bottom-right {
		position:absolute;
		bottom:0.25em;
		right: 0.25em;
	}

	.badges-container .bottom-left {
		position: absolute;
		bottom:0.25em;
		left: 0.25em;
	}
	${badgeStyles}
`;

//badgeMap is the result of selectBadgeMap (or null is fine); Warning: you also
//need to embed cardBadgeStyles at least once If selectTarget is passed, then it
//will render a checkbox that will have that method called with the ven ton
//change. If not provided, it will not render a select checkbox.
export const cardBadges = (light : boolean, card : OptionalFieldsCard | null, badgeMap : BadgeMap, selectTarget? : (e : MouseEvent) => void) => {
	if (!badgeMap) badgeMap = {
		stars: {},
		reads: {},
		todos: {},
		readingList: {},
		selected: {}
	};
	if (!card) return html``;
	const starMap = badgeMap.stars || {};
	const readMap = badgeMap.reads || {};
	const todoMap = badgeMap.todos || {};
	const readingListMap = badgeMap.readingList || {};
	const nonBlankCard = card || {};
	const id = nonBlankCard?.id || '';
	const refs = references(nonBlankCard).byTypeArray()['dupe-of'];
	const isDupe = Boolean(refs && refs.length > 0);
	return html`
	  <div class="badges-container ${light ? 'light' : ''}">
		<div class='top-right'>
			${badge('star-count', STAR_ICON, nonBlankCard?.star_count || 0, starMap[id])}
			${badge('todo', ASSIGNMENT_TURNED_IN_ICON, todoMap[id])}
		</div>
		${badge('read', VISIBILITY_ICON, readMap[id])}
		<div class='bottom-right'>
			${badge('thread-count', FORUM_ICON, nonBlankCard?.thread_count || 0)}
			${badge('duplicate', COPY_ALL_ICON, isDupe, true)}
		</div>
		<div class='bottom-left'>
			${selectTarget ? html`<input
				type='checkbox'
				.checked=${badgeMap.selected[id]}
				@change=${selectTarget}
				data-card-id=${id}
				></input>
			` : ''}
			${badge('reading-list', PLAYLISLT_ADD_CHECK_ICON, readingListMap[id])}
		</div>
	</div>
    `;
};