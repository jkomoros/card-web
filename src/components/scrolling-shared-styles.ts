import { css } from 'lit';

//The shared scroller idiom (#759). History: this module used to pick between
//two style blocks at import time via a DOM-probing areScrollbarsVisible()
//(an import-time side effect that also required document.body to exist and
//could never react to the user plugging in a mouse mid-session), and both
//blocks were built on `overflow: overlay` — a value Chromium has since
//removed as a distinct behavior: it still parses, so CSS.supports reports
//true, but it computes to `auto`. On overlay-scrollbar systems the whole
//module therefore resolved to `.scroller { overflow: auto }` and nothing
//else; on always-show systems it contributed ::-webkit-scrollbar styling
//that made this app's scrollbars quietly nonstandard per-machine.
//
//The standard properties need no probe: scrollbar-width/scrollbar-color are
//supported everywhere this app runs, thin scrollbars keep the unobtrusive
//intent of the old faux treatment, and overlay-scrollbar systems simply
//ignore the color hints. `auto`, never `scroll` or `overlay`: `scroll`
//reserves a permanent gutter on always-show systems whether or not content
//overflows (use scrollbar-gutter: stable where layout shift matters), and
//`overlay` is a no-op lie. A source-text test enforces that no component
//declares either outside this module.
export const ScrollingSharedStyles = css`
	.scroller {
		overflow: auto;
		scrollbar-width: thin;
		scrollbar-color: rgb(0 0 0 / 30%) transparent;
	}
`;
