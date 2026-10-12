/* eslint-env node, es2022 */
import {
	cardDerivedMembershipFromFilterMap,
	membershipSize,
	updateCardDerivedMembership,
} from '../../shared/dist/filter_membership.js';

global.gc();
const before=process.memoryUsage().heapUsed;
let membership=cardDerivedMembershipFromFilterMap({});
for(let index=0;index<5000;index++){
	membership=updateCardDerivedMembership(membership,{add:[`card-${String(index).padStart(5,'0')}`]});
}
global.gc();
console.log(JSON.stringify({
	bytes:process.memoryUsage().heapUsed-before,
	size:membershipSize(membership),
}));
