/* eslint-env node, es2022 */
import {
	cardDerivedMembershipsFromFilterMaps,
	membershipKeys,
	updateCardDerivedMembershipGroup,
} from '../../shared/dist/filter_membership.js';

global.gc();
const before=process.memoryUsage().heapUsed;
let memberships=cardDerivedMembershipsFromFilterMaps([{toggled:true,kept:true},{rolling:true}]);
let previous='rolling';
for(let index=0;index<100000;index++){
	const next=`temporary-${index}`;
	memberships=updateCardDerivedMembershipGroup([
		{membership:memberships[0],remove:['toggled'],add:['toggled']},
		{membership:memberships[1],remove:[previous],add:[next]},
	]);
	previous=next;
}
global.gc();
const bytes=process.memoryUsage().heapUsed-before;
if(membershipKeys(memberships[0]).join()!=='kept,toggled'||membershipKeys(memberships[1]).join()!==previous)throw new Error('churn changed membership contents');
console.log(JSON.stringify({bytes}));
