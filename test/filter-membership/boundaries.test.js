/* eslint-env node, mocha, es2022 */
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {inspectMembershipUsage} = require('../../tools/check-filter-membership.cjs');

describe('typed filter membership boundary guard', () => {
	let root;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'membership-boundary-'));
		mkdirSync(join(root, 'shared'));
		writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({compilerOptions:{strict:true, target:'ES2022', module:'NodeNext', moduleResolution:'NodeNext', lib:['ES2022','DOM'], types:[]}, include:['**/*.ts']}));
		writeFileSync(join(root, 'shared/filter_membership.ts'), `
export class CardDerivedMembership { private brand = true; }
export type FilterMap = {[id:string]:true};
export type FilterMembership = FilterMap | CardDerivedMembership;
export declare function membershipHas(m:FilterMembership,id:string):boolean;
export declare function membershipToMap(m:FilterMembership):FilterMap;
export declare function membershipKeys(m:FilterMembership):string[];
`);
	});
	afterEach(() => rmSync(root, {recursive:true, force:true}));
	const check = body => {
		writeFileSync(join(root, 'consumer.ts'), `import {FilterMembership,FilterMap,membershipHas,membershipKeys,membershipToMap} from './shared/filter_membership.js';\ndeclare const m:FilterMembership; declare const plain:FilterMap;\n${body}\n`);
		return inspectMembershipUsage(join(root, 'tsconfig.json'));
	};
	it('allows explicit helpers, plain maps and the outer filter-name dictionary', () => {
		assert.deepEqual(check('membershipHas(m,\'a\'); membershipKeys(m); Object.keys(plain); Object.keys({published:m}); Object.freeze(m); Object.isFrozen(m); structuredClone({published:membershipToMap(m)});'), []);
	});
	it('rejects native object operations, including aliased builtins', () => {
		const result = check('m[\'a\']; const spread={...m}; for(const id in m){} Object.keys(m); const keys=Object.keys; keys(m); Object.entries(m); Object.assign({},m); Object.getOwnPropertyDescriptors(m); Object.hasOwn(m,\'a\'); Reflect.ownKeys(m); Object.prototype.hasOwnProperty.call(m,\'a\');');
		assert.equal(result.length, 11, JSON.stringify(result));
	});
	it('rejects ownership-erasing casts and nested wire payloads', () => {
		const result = check('const erased=m as unknown; const lied=m as FilterMap; structuredClone({filters:{published:m}}); const clone=structuredClone; clone([m]); declare const worker:Worker; worker.postMessage({filters:{published:m}});');
		assert.equal(result.length, 5, JSON.stringify(result));
	});
	it('tracks Map/Set payloads and nested ownership erasure', () => {
		const result = check('structuredClone(new Map([[\'id\',m]])); structuredClone(new Set([m])); const erased={nested:m} as unknown; JSON.stringify({nested:m});');
		assert.equal(result.length, 4, JSON.stringify(result));
	});
	it('rejects in, instance membership methods and indirect native calls', () => {
		const result = check('\'a\' in m; m.hasOwnProperty(\'a\'); m.propertyIsEnumerable(\'a\'); Object.keys.call(Object,m); Object.keys.apply(Object,[m]);');
		assert.equal(result.length, 5, JSON.stringify(result));
	});
	it('allows unrelated local methods named like browser functions', () => {
		assert.deepEqual(check('const local={postMessage(value:FilterMembership){return value;}, structuredClone(value:FilterMembership){return value;}}; local.postMessage(m); local.structuredClone(m);'), []);
	});
	it('allows DTOs whose mapped or phantom generic parameters discard memberships', () => {
		assert.deepEqual(check('type Mixed={m:FilterMembership;plain:string}; declare const picked:Pick<Mixed,\'plain\'>; declare const omitted:Omit<Mixed,\'m\'>; type Phantom<T>={id:string}; declare const phantom:Phantom<FilterMembership>; structuredClone(picked); structuredClone(omitted); structuredClone(phantom);'), []);
	});
	it('rejects annotated ownership erasure and indirect native serialization', () => {
		const result = check('const erased:unknown={nested:m}; const object:object=m; structuredClone.call(globalThis,{nested:m}); structuredClone.apply(globalThis,[{nested:m}]); JSON.stringify.call(JSON,{nested:m});');
		assert.equal(result.length, 5, JSON.stringify(result));
	});

});
