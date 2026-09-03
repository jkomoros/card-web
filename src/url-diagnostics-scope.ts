import {
	URLDiagnostic
} from '../shared/url-diagnostics.js';

//A LEAF MODULE ON PURPOSE.
//
//This used to live in selectors.ts, which is fine for the drawer notice but
//not for the second consumer: collection history has to ask the same question
//(did this arrival raise diagnostics?) and cannot import selectors.ts, which
//reaches firebase. The matching rule is one function and belongs where both
//can reach it without dragging a graph behind them. selectors.ts re-exports it,
//so every existing import site is unchanged.

//The diagnostics that apply to a given URL: a diagnostic names the URL part
//it could not understand, so it applies exactly when that part (as a whole
//segment sequence) is present in the URL being looked at. This is what
//makes the notice self-scoping (#757): navigating away hides it,
//revisiting the same bad URL shows it again, and there is no clear/
//re-report cycle to get wrong.
//
//Scope against the RAW URL, never against description.serialize(): the
//canonical serialization by construction contains only the parts the
//parser KEPT, and several report sites name parts the parser DROPPED — a
//bogus view mode ('view/bogus') or a reversed bad sort ('sort/bogus'
//against a serialized 'sort/reverse/bogus') — so those notices could never
//match their own URL (#757 review, verified by execution).
//
//Known accepted limitation: matching is textual, so a stale un-retracted
//part from URL A can match a coincidentally identical segment on URL B
//where that text is valid in a different role (e.g. a former filter typo
//'stars' on /sort/stars/). Bounded by retraction, the 24-entry cap, and
//self-hiding on navigation. Pure and exported for tests.
export const urlDiagnosticsForRawURL = (diagnostics : URLDiagnostic[], rawURL : string) : URLDiagnostic[] => {
	const haystack = '/' + rawURL.replace(/^\/+|\/+$/g, '') + '/';
	return diagnostics.filter(diagnostic => haystack.includes('/' + diagnostic.part.replace(/^\/+|\/+$/g, '') + '/'));
};
