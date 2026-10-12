/* eslint-env node, mocha, es2022 */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import dataReducer from '../../lib/src/reducers/data.js';
import {UPDATE_CARDS, REMOVE_CARDS, UPDATE_COLLECTION_SHAPSHOT} from '../../lib/src/actions.js';
import {sharedDiffCards, diffCards, createCardsDiffSelector, anyCardMatches} from '../../lib/src/incremental-selectors.js';

const card = (id, extra = {}) => ({id, card_type: 'content', slugs: [], ...extra});
const stateFor = cards => ({...dataReducer(undefined, {type: 'init'}), cards, cardsSnapshot: cards});
const update = (state, cards) => dataReducer(state, {type: UPDATE_CARDS, cards, fetchType: 'published'});
const remove = (state, cardIDs) => dataReducer(state, {type: REMOVE_CARDS, cardIDs});
const exact = (before, after) => assert.deepEqual(sharedDiffCards(before, after), diffCards(before, after));

describe('reducer-owned exact card deltas', () => {
	it('preserves ordered deltas and snapshots for real update/removal actions including unusual keys', () => {
		const ids = ['z', '2', 'a', '0', '01', '__proto__', 'constructor', 'toString'];
		for (const id of ids) {
			const original = Object.fromEntries(ids.map(key => [key, card(key)]));
			let state = stateFor(original);
			const saved = JSON.stringify(original);
			for (const batch of [Object.fromEntries([[id, card(id, {notes: 'echo'})]]),
				Object.fromEntries([['10', card('10')], [id, card(id, {body: 'body'})], ['1', card('1')], ['new', card('new')]]),
				Object.fromEntries([['a', card('a', {title: 'A'})], ['z', card('z', {title: 'Z'})]]),
				Object.fromEntries([[id, state.cards[id]]]), {}]) {
				const before = state;state = update(state, batch);exact(before.cards, state.cards);
				assert.equal(JSON.stringify(original), saved);
			}
			state = dataReducer(state, {type: UPDATE_COLLECTION_SHAPSHOT});
			for (const deletion of [[id, id, 'missing'], ['z', 'a'], ['2'], ['missing']]) {
				const before = state, oldKeys = Object.keys(before.cards);
				state = remove(state, deletion);exact(before.cards, state.cards);exact(before.cardsSnapshot, state.cardsSnapshot);
				assert.deepEqual(Object.keys(before.cards), oldKeys);
			}
		}
	});

	it('keeps touched malformed values and inherited-name behavior on the original path', () => {
		for (const value of [null, undefined, false, 0]) {
			const before = stateFor({a: value});const after = remove(before, ['a']);
			assert(Object.prototype.hasOwnProperty.call(after.cards, 'a'));
			exact(before.cards, after.cards);
		}
		for (const id of ['constructor', '__proto__', 'toString']) {
			const before = stateFor({a: card('a')});const after = update(before, Object.fromEntries([[id, card(id)]]));
			exact(before.cards, after.cards);exact(after.cards, remove(after, [id]).cards);
		}
	});

	it('avoids rediscovering single-card changes through the full parent map at 50k', () => {
		let reads = 0, enumerations = 0;
		const raw = Object.fromEntries(Array.from({length: 50000}, (_, index) => ['c' + index, card('c' + index)]));
		const observed = new Proxy(raw, {get(target, key, receiver) {if (Object.hasOwn(target, key)) reads++;return Reflect.get(target, key, receiver);}, ownKeys(target) {enumerations++;return Reflect.ownKeys(target);}});
		const select = createCardsDiffSelector({name: 'known-concepts-test', needsRecompute: delta => anyCardMatches(delta, c => c.card_type === 'concept'), compute: cards => Object.values(cards).filter(c => c.card_type === 'concept')});
		const before = stateFor(observed), original = select(before.cards);
		const next = update(before, {c3: card('c3', {notes: 'metadata echo'})});
		reads = 0;enumerations = 0;
		assert.strictEqual(select(next.cards), original);
		assert.equal(reads, 0);assert.equal(enumerations, 0);
		const removed = remove(before, ['c4', 'c4', 'missing']);reads = 0;enumerations = 0;
		const removalDelta = sharedDiffCards(before.cards, removed.cards);
		assert.equal(reads, 0);assert.equal(enumerations, 0);
		assert.deepEqual(removalDelta, diffCards(before.cards, removed.cards));
	});

	it('falls back for skipped parents, reversed pairs and batches with more than one change or removal', () => {
		let reads = 0;
		const raw = Object.fromEntries(['z', 'a', 'm'].map(id => [id, card(id)]));
		const before = stateFor(new Proxy(raw, {get(target, key, receiver) {if (Object.hasOwn(target, key)) reads++;return Reflect.get(target, key, receiver);}}));
		const first = update(before, {a: card('a', {notes: 'one'})});
		const second = update(first, {z: card('z', {notes: 'two'})});
		reads = 0;const skipped = sharedDiffCards(before.cards, second.cards);assert(reads > 0);assert.deepEqual(skipped, diffCards(before.cards, second.cards));
		exact(second.cards, first.cards);exact(first.cards, second.cards);
		const multi = update(before, {a: card('a', {notes: 'A'}), z: card('z', {notes: 'Z'})});
		reads = 0;const delta = sharedDiffCards(before.cards, multi.cards);assert(reads > 0);assert.deepEqual(delta.changed.map(([old]) => old.id), ['z', 'a']);
		const removed = remove(before, ['a', 'z']);reads = 0;
		assert.deepEqual(sharedDiffCards(before.cards, removed.cards).removed.map(c => c.id), ['z', 'a']);assert(reads > 0);
	});

	it('does not retain parent chains when only the latest reducer state remains', () => {
		const script = `import dataReducer from './lib/src/reducers/data.js';import {UPDATE_CARDS} from './lib/src/actions.js';
		const make=()=>{let state=dataReducer(undefined,{type:'init'});const refs=[];for(let i=0;i<100;i++){refs.push(new WeakRef(state.cards));state=dataReducer(state,{type:UPDATE_CARDS,cards:{x:{id:'x',card_type:'content',slugs:[],notes:String(i)}},fetchType:'published'});}return {state,refs};};
		const held=make();for(let i=0;i<6;i++){await new Promise(r=>setImmediate(r));global.gc();}const count=held.refs.slice(1).filter(r=>r.deref()).length;if(count!==0)throw Error('retained '+count+' historical maps');console.log('latest map held, historical maps released');`;
		const result = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', script], {encoding: 'utf8', timeout: 10000});
		assert.equal(result.status, 0, result.stderr);
	});
});
