/* eslint-env node, es2022 */
import assert from 'node:assert/strict';
import {cardDerivedMembershipFromFilterMap,updateCardDerivedMembership} from '../../shared/dist/filter_membership.js';

let reference;
const createDiscardedHistory=()=>{
	let membership=cardDerivedMembershipFromFilterMap({kept:true});
	for(let index=0;index<3000;index++)membership=updateCardDerivedMembership(membership,{add:[`future-${index}`],remove:index?[`future-${index-1}`]:[]});
	reference=new WeakRef(membership);
};
createDiscardedHistory();
// A WeakRef target dereferenced in the current job is kept alive until that
// job ends. Yield before each GC so the condition check cannot itself pin it.
const strongControl=process.env.FILTER_MEMBERSHIP_STRONG_CONTROL?reference.deref():null;
for(let attempt=0;attempt<50;attempt++){
	await new Promise(resolve=>setImmediate(resolve));
	global.gc();
	await new Promise(resolve=>setImmediate(resolve));
	if(!reference.deref())break;
}
assert.equal(reference.deref(),undefined,'discarded persistent history remained strongly reachable');
console.log('collected',Boolean(strongControl));
