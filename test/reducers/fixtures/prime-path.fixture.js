/* eslint-env node, es2022 */
//Runs in its own process: perf counters are enabled by localStorage at the
//moment perf.js first loads, and the reducers suite's other files load it
//before any one test could set that up.
import {JSDOM} from 'jsdom';

const dom = new JSDOM('', {url: 'http://localhost/'});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
dom.window.localStorage.setItem('debug-perf', '1');

await import('../../../lib/src/perf.js');
const collectionReducer = (await import('../../../lib/src/reducers/collection.js')).default;
const {INITIAL_STATE} = await import('../../../lib/src/filters.js');
const {UPDATE_CARDS} = await import('../../../lib/src/actions.js');
const {membershipKeys, membershipHas} = await import('../../../lib/shared/filter_membership.js');

const makeCard = (id, extras = {}) => ({
	id, card_type: 'content', title: 'Title of ' + id, body: '<p>Body of ' + id + '</p>', section: 'main', tags: [],
	references: {}, references_info: {}, references_inbound: {}, references_info_inbound: {},
	star_count: 0, star_count_manual: 0, tweet_favorite_count: 0, tweet_retweet_count: 0, thread_count: 0, thread_resolved_count: 0,
	notes: '', todo: '', auto_todo_overrides: {}, published: true, full_bleed: false, images: [], slugs: [], ...extras,
});
const counter = () => window.DEBUG_PERF.data().counters['makeFilterFromCards:primeBulk'] || 0;
const result = {};

window.DEBUG_PERF.reset();
const cards = Object.fromEntries(Array.from({length: 1200}, (_, i) => ['c' + i, makeCard('c' + i, {published: i % 2 === 0})]));
let state = collectionReducer(INITIAL_STATE, {type: UPDATE_CARDS, cards, fetchType: 'published'});
result.afterPrime = counter();
result.publishedCount = membershipKeys(state.filters.published).length;
state = collectionReducer(state, {type: UPDATE_CARDS, cards: Object.fromEntries(Array.from({length: 1200}, (_, i) => ['d' + i, makeCard('d' + i)])), fetchType: 'published'});
result.afterSecondLargeUpdate = counter();
result.secondUpdateApplied = membershipHas(state.filters.published, 'd7');

window.DEBUG_PERF.reset();
const duplicated = Object.fromEntries(Array.from({length: 1200}, (_, i) => ['c' + i, makeCard('c' + i)]));
//Two keys, one card id: the value disagrees with its key.
duplicated.ghost = makeCard('c5', {published: false});
const dupState = collectionReducer(INITIAL_STATE, {type: UPDATE_CARDS, cards: duplicated, fetchType: 'published'});
result.dupPrimeCount = counter();
result.dupHasC5 = membershipHas(dupState.filters['has-content'], 'c5');
result.dupContentSize = membershipKeys(dupState.filters['has-content']).length;
console.log(JSON.stringify(result));
