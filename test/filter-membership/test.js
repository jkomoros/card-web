/* eslint-env node, mocha, es2022 */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
	CardDerivedMembership,
	cardDerivedMembershipFromFilterMap,
	cardDerivedMembershipsFromFilterMaps,
	isCardDerivedMembership,
	membershipEntries,
	membershipHas,
	membershipKeys,
	membershipSize,
	membershipToFilterMap,
	updateCardDerivedMembership,
	updateCardDerivedMembershipGroup,
} from '../../shared/dist/filter_membership.js';

const mapFrom = ids => Object.fromEntries(ids.map(id => [id, true]));

describe('persistent card filter membership', () => {
	it('preserves own-key order, special IDs and delete/re-add order', () => {
		const longID='x'.repeat(1500);
		const ids=['last','2','01','first','0','-0','4294967294','4294967295','é','constructor','toString','__proto__',longID];
		const plain=mapFrom(ids);let membership=cardDerivedMembershipFromFilterMap(plain);
		assert.deepEqual(membershipKeys(membership),Object.keys(plain));
		assert.deepEqual(membershipEntries(membership),Object.entries(plain));
		for(const id of ids)assert.equal(membershipHas(membership,id),true,id);
		const previous=membership;membership=updateCardDerivedMembership(membership,{remove:['last','last'],add:['new','last']});
		const expected={...plain};delete expected.last;expected.new=true;expected.last=true;
		assert.deepEqual(membershipKeys(membership),Object.keys(expected));
		assert.deepEqual(membershipKeys(previous),Object.keys(plain),'old snapshot changed');
		assert.equal(membershipSize(membership),Object.keys(expected).length);
	});

	it('preserves no-op identity and plain-map truthiness without inherited membership', () => {
		const membership=cardDerivedMembershipFromFilterMap({a:true});
		assert.strictEqual(updateCardDerivedMembership(membership,{add:['a','a']}),membership);
		assert.strictEqual(updateCardDerivedMembership(membership,{remove:['missing','missing']}),membership);
		const plain=Object.create({constructor:true,toString:true});plain.truthy=1;plain.falsy=0;
		assert.equal(membershipHas(plain,'truthy'),true);assert.equal(membershipHas(plain,'falsy'),false);
		assert.equal(membershipHas(plain,'constructor'),false);assert.equal(membershipHas(plain,'toString'),false);
	});

	it('keeps storage opaque and requires explicit plain transport', () => {
		assert.throws(()=>new CardDerivedMembership(Symbol()),/created by filter membership helpers/);
		const membership=cardDerivedMembershipFromFilterMap({a:true,b:true});
		assert.deepEqual(Object.keys(membership),[]);assert(Object.isFrozen(membership));
		const clone=structuredClone(membership);assert.equal(isCardDerivedMembership(clone),false);assert.deepEqual(clone,{});
		const plain=membershipToFilterMap(membership);assert.deepEqual(plain,{a:true,b:true});plain.a=false;
		assert.equal(membershipHas(membership,'a'),true,'transport mutation reached private membership state');
	});

	it('updates a 50k snapshot without the old value seeing future IDs', () => {
		const ids=Array.from({length:50000},(_,index)=>`card-${String(index).padStart(5,'0')}`);
		const original=cardDerivedMembershipFromFilterMap(mapFrom(ids));
		const changed=updateCardDerivedMembership(original,{remove:ids.slice(0,30),add:['future-a','future-b']});
		assert.equal(membershipSize(original),50000);assert.equal(membershipHas(original,'future-a'),false);
		assert.equal(membershipSize(changed),49972);assert.equal(membershipHas(changed,'future-a'),true);
		assert.deepEqual(membershipKeys(original).slice(0,3),ids.slice(0,3));
		assert.deepEqual(membershipKeys(changed).slice(-2),['future-a','future-b']);
	}).timeout(30000);

	it('extends and compacts one shared domain for a complete membership group', () => {
		let memberships=cardDerivedMembershipsFromFilterMaps([
			{shared:true,left:true},
			{shared:true,right:true},
		]);
		const untouched=memberships[1];
		memberships=updateCardDerivedMembershipGroup([
			{membership:memberships[0],add:['new-id']},
			{membership:memberships[1]},
		]);
		assert.equal(membershipHas(memberships[0],'new-id'),true);
		assert.equal(membershipHas(memberships[1],'new-id'),false);
		assert.strictEqual(memberships[1],untouched,'unchanged sibling identity was replaced');
		// More than the compaction threshold of delete/re-add tombstones in one
		// member rebuilds the entire group. A later shared extension must remain
		// valid, proving compaction did not split the domain lineage.
		for(let index=0;index<1030;index++)memberships=updateCardDerivedMembershipGroup([
			{membership:memberships[0],remove:['left'],add:['left']},
			{membership:memberships[1]},
		]);
		memberships=updateCardDerivedMembershipGroup([
			{membership:memberships[0],add:['after-compaction']},
			{membership:memberships[1]},
		]);
		assert.equal(membershipHas(memberships[0],'after-compaction'),true);
		assert.equal(membershipHas(memberships[1],'right'),true);
	});

	it('rejects incompatible domain branches', () => {
		const base=cardDerivedMembershipFromFilterMap({a:true});
		const left=updateCardDerivedMembership(base,{add:['left']});
		const right=updateCardDerivedMembership(base,{add:['right']});
		assert.throws(()=>updateCardDerivedMembershipGroup([
			{membership:left},
			{membership:right},
		]),/does not share one domain lineage/);
	});

	it('compacts local order churn without rebuilding a large sibling', () => {
		const ids=Array.from({length:50000},(_,index)=>`card-${String(index).padStart(5,'0')}`);
		let memberships=cardDerivedMembershipsFromFilterMaps([
			mapFrom(ids),
			{churn:true},
		]);
		const large=memberships[0];
		for(let index=0;index<1024;index++)memberships=updateCardDerivedMembershipGroup([
			{membership:memberships[0]},
			{membership:memberships[1],remove:['churn'],add:['churn']},
		]);
		assert.strictEqual(memberships[0],large,'local order compaction rebuilt an unchanged large sibling');
		assert.deepEqual(membershipKeys(memberships[1]),['churn']);
	}).timeout(30000);

	it('preserves exact memberships through deleted-ID domain churn', () => {
		let memberships=cardDerivedMembershipsFromFilterMaps([{kept:true},{sibling:true}]);
		let prior;
		for(let index=0;index<2200;index++){
			const id=`temporary-${index}`;
			memberships=updateCardDerivedMembershipGroup([
				{membership:memberships[0],remove:prior?[prior]:[],add:[id]},
				{membership:memberships[1]},
			]);
			prior=id;
		}
		assert.deepEqual(membershipKeys(memberships[0]),['kept','temporary-2199']);
		assert.deepEqual(membershipKeys(memberships[1]),['sibling']);
		memberships=updateCardDerivedMembershipGroup([
			{membership:memberships[0],add:['after-domain-compaction']},
			{membership:memberships[1]},
		]);
		assert.equal(membershipHas(memberships[0],'after-domain-compaction'),true);
	});

	it('does not retain discarded membership histories through module caches', () => {
		const result=spawnSync(process.execPath,['--expose-gc',new URL('./weak-retention.fixture.js',import.meta.url).pathname],{encoding:'utf8',timeout:30000});
		assert.equal(result.status,0,result.stdout+result.stderr);
		assert.match(result.stdout,/collected/);
		const strongControl=spawnSync(process.execPath,['--expose-gc',new URL('./weak-retention.fixture.js',import.meta.url).pathname],{
			encoding:'utf8',
			timeout:30000,
			env:{...process.env,FILTER_MEMBERSHIP_STRONG_CONTROL:'1'},
		});
		assert.notEqual(strongControl.status,0,'retention fixture accepted a real strong reference');
		assert.match(strongControl.stderr,/discarded persistent history remained strongly reachable/);
	});

	it('compacts order churn and reclaims deleted ids instead of growing without bound', () => {
		//Toggling one id 100k times writes 100k order-log tombstones, and
		//100k rolling temporary ids append 100k dead ordinals to the shared
		//domain. Without order compaction the log alone retains ~20 MB;
		//without domain reclamation the index retains ~7 MB. The real code
		//retains under 1 MB. The compaction tests above pass with both
		//mechanisms disabled; this one does not.
		const result=spawnSync(process.execPath,['--expose-gc',new URL('./churn-heap.fixture.js',import.meta.url).pathname],{encoding:'utf8',timeout:60000});
		assert.equal(result.status,0,result.stdout+result.stderr);
		const measurement=JSON.parse(result.stdout);
		assert(measurement.bytes < 3*1024*1024,`churned memberships retained ${measurement.bytes} bytes`);
	}).timeout(60000);

	it('does not retain superseded domain indexes through the latest snapshot', () => {
		const result=spawnSync(process.execPath,['--expose-gc',new URL('./retained-history.fixture.js',import.meta.url).pathname],{encoding:'utf8',timeout:30000});
		assert.equal(result.status,0,result.stdout+result.stderr);
		const measurement=JSON.parse(result.stdout);
		assert.equal(measurement.size,5000);
		// This has broad headroom over the observed ~1.1 MiB while still
		// rejecting an implementation that retains every prior AVL root (~35 MiB).
		assert(measurement.bytes < 8*1024*1024,`latest membership retained ${measurement.bytes} bytes`);
	});
});

//The id index is one Map shared along a domain lineage (the tip appends in
//place; an older domain reads ordinals below its own size). These pin the
//two invariants that makes rely on: an older snapshot never sees ids added
//after it, and extending a NON-tip snapshot forks a lineage rather than
//corrupting the shared one.
describe('lineage-tip id index', () => {
	it('an older snapshot never sees ids appended after it, and extending it forks the lineage', () => {
		const base=cardDerivedMembershipFromFilterMap({a:true,b:true});
		const tip=updateCardDerivedMembership(base,{add:['c']});
		//base is now behind the tip. Extend base itself: this must not see or
		//disturb 'c', and must give 'x' its own ordinal on a forked lineage.
		const forked=updateCardDerivedMembership(base,{add:['x']});
		assert.equal(membershipHas(base,'c'),false,'older snapshot saw a later id');
		assert.equal(membershipHas(base,'x'),false,'older snapshot saw a forked id');
		assert.deepEqual(membershipKeys(base),['a','b']);
		assert.deepEqual(membershipKeys(tip),['a','b','c']);
		assert.equal(membershipHas(tip,'x'),false,'tip saw an id from the forked lineage');
		assert.deepEqual(membershipKeys(forked),['a','b','x']);
		//The case the size check exists for: re-add to the OLDER snapshot an id
		//the tip already appended. Without it the shared index reports 'c' as
		//present, nothing is appended, and the bit lands on an ordinal the
		//older domain has no id for.
		const readded=updateCardDerivedMembership(base,{add:['c']});
		assert.deepEqual(membershipKeys(readded),['a','b','c']);
		assert.equal(membershipHas(readded,'c'),true);
		assert.equal(membershipSize(readded),3);
		assert.equal(membershipHas(forked,'c'),false,'fork saw an id from the tip lineage');
		//The two lineages can each keep extending, and still cannot be mixed.
		const tip2=updateCardDerivedMembership(tip,{add:['d']});
		const forked2=updateCardDerivedMembership(forked,{add:['d']});
		assert.deepEqual(membershipKeys(tip2),['a','b','c','d']);
		assert.deepEqual(membershipKeys(forked2),['a','b','x','d']);
		assert.throws(()=>updateCardDerivedMembershipGroup([{membership:tip2},{membership:forked2}]),/does not share one domain lineage/);
		//Siblings on one lineage at different sizes still group: the older one
		//is an ancestor of the tip by shared index.
		const grouped=updateCardDerivedMembershipGroup([{membership:tip2,add:['e']},{membership:base}]);
		assert.deepEqual(membershipKeys(grouped[0]),['a','b','c','d','e']);
		assert.strictEqual(grouped[1],base,'an untouched older sibling keeps its identity');
	});

	it('extending the tip is bounded per id (no index copy)', () => {
		//50k ids added one at a time along the tip must stay far below the
		//cost of copying the index each time; a quadratic index copy would
		//take tens of seconds here.
		let membership=cardDerivedMembershipFromFilterMap({});
		const started=Date.now();
		for(let index=0;index<50000;index++)membership=updateCardDerivedMembership(membership,{add:[`id-${index}`]});
		assert.equal(membershipSize(membership),50000);
		assert(Date.now()-started<5000,'tip extension is not O(1) per id');
	}).timeout(30000);
});

describe('prime bitset builder', () => {
	it('builds the same memberships as the plain-map importer, sharing equal filters', async () => {
		const {cardDerivedMembershipsFromPrime}=await import('../../shared/dist/filter_membership.js');
		//6,500 ids crossing chunk boundaries, with ids a plain object would
		//reorder (integer-like) and ids that collide with Object.prototype.
		const ids=[];
		for(let index=0;index<6500;index++)ids.push(index%7===0?String(index*3):index%11===0?`${'z'.repeat(40)}-${index}`:`card-${index}`);
		ids[5]='__proto__';ids[6]='constructor';ids[7]='toString';ids[8]='4294967295';
		const predicates=[i=>i%2===0,i=>i%3===0,i=>i%2===0,()=>false,i=>i>6000,()=>true];
		const words=predicates.map(()=>new Uint32Array(Math.ceil(ids.length/32)));
		//Null-prototype oracles: a plain {} cannot hold '__proto__' as a key.
		const maps=predicates.map(()=>Object.create(null));
		for(let i=0;i<ids.length;i++)for(let f=0;f<predicates.length;f++)if(predicates[f](i)){words[f][i>>>5]|=1<<(i&31);maps[f][ids[i]]=true;}
		const fromPrime=cardDerivedMembershipsFromPrime(ids,words);
		const fromMaps=cardDerivedMembershipsFromFilterMaps(maps);
		for(let f=0;f<predicates.length;f++){
			assert.deepEqual(membershipKeys(fromPrime[f]),membershipKeys(fromMaps[f]),`filter ${f} keys`);
			assert.deepEqual(membershipKeys(fromPrime[f]),Object.keys(maps[f]),`filter ${f} plain-map order`);
			assert.equal(membershipSize(fromPrime[f]),Object.keys(maps[f]).length);
			for(const id of ids)assert.equal(membershipHas(fromPrime[f],id),Boolean(maps[f][id]),`filter ${f} has ${id}`);
		}
		assert.strictEqual(fromPrime[0],fromPrime[2],'equal bitsets share one membership');
		assert.notStrictEqual(fromPrime[0],fromPrime[1]);
		//The result is a normal membership: it updates and groups like any other.
		const updated=updateCardDerivedMembershipGroup([{membership:fromPrime[3],add:['brand-new']},{membership:fromPrime[5],remove:[ids[0]]}]);
		assert.deepEqual(membershipKeys(updated[0]),['brand-new']);
		assert.equal(membershipHas(updated[1],ids[0]),false);
		assert.equal(membershipSize(updated[1]),ids.length-1);
		assert.throws(()=>cardDerivedMembershipsFromPrime(['a','a'],[new Uint32Array(1)]),/unique/);
	}).timeout(30000);
});
