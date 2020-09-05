import { html } from '@polymer/lit-element';

import {
	PLAYLISLT_ADD_CHECK_ICON,
	FORUM_ICON,
	VISIBILITY_ICON,
	ASSIGNMENT_TURNED_IN_ICON,
	STAR_ICON
} from './my-icons.js';

const badge = (name, icon, countOrVisible, highlighted) => {
	const text = typeof countOrVisible == 'number' ? countOrVisible : '';
	return html`<div class='badge ${name} ${highlighted ? 'highlighted' : ''}' ?hidden=${!countOrVisible}><div>${icon}${text}</div></div>`;
};

//if you use starBadge, also print out badgeStyles within your component's shadowDOM.
export const starBadge = (count, highlighted) => {
	return badge('star-count', STAR_ICON, count, highlighted);
};

export const badgeStyles =  html`
	<style>
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

			svg {
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
	</style>
`;

//badgeMap is the result of selectBadgeMap (or null is fine);
export const cardBadges = (light, card, badgeMap) => {
	if (!badgeMap) badgeMap = {};
	const starMap = badgeMap.stars || {};
	const readMap = badgeMap.reads || {};
	const todoMap = badgeMap.todos || {};
	const readingListMap = badgeMap.readingList || {};
	const nonBlankCard = card || {};
	const id = nonBlankCard.id;
	return html`
      <style>

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

        .badges-container .read{
          position:absolute;
          left: 0.25em;
          top: 0.25em;
        }

        .badges-container .thread-count {
          position:absolute;
          bottom:0.25em;
          right: 0.25em;
        }

        .badges-container .reading-list {
          position: absolute;
          bottom:0.25em;
          left: 0.25em;
        }
	  </style>
	  ${badgeStyles}
	  <div class="badges-container ${light ? 'light' : ''}">
		<div class='top-right'>
			${badge('star-count', STAR_ICON, nonBlankCard.star_count, starMap[id])}
			${badge('todo', ASSIGNMENT_TURNED_IN_ICON, todoMap[id])}
		</div>
		${badge('read', VISIBILITY_ICON, readMap[id])}
		${badge('thread-count', FORUM_ICON, nonBlankCard.thread_count)}
		${badge('reading-list', PLAYLISLT_ADD_CHECK_ICON, readingListMap[id])}
	</div>
    `;
};