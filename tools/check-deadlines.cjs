/*eslint-env node*/

//Dated forcing functions, enforced where refusing actually helps: BEFORE A
//DEPLOY.
//
//This started life as a throwing test inside `npm test`, which meant the
//deadline hard-failed the suite for whoever happened to merge after that date —
//over a change of theirs that had nothing to do with it. A deadline that breaks
//a stranger's build lands on whoever is nearest rather than whoever can act,
//and the usual response is to delete it.
//
//Deploying rules that are still staged-open is the real hazard, so that is what
//this blocks. `npm test` still WARNS in the three weeks beforehand, so the
//reminder stays visible without being destructive.
//
//To extend a deadline: change the date HERE, in the same commit that records
//why. That is the intended escape hatch, not a workaround.

const DEADLINES = [
	{
		date: '2026-09-15T00:00:00Z',
		what: 'the staged inbound-reference `updated` carve-out',
		then: 'Flip the two STAGED tests in test/security/test.js to assertFails and deploy the tightened rules (docs/prod-cutover-runbook.md, Phase 6).',
	},
];

const WARN_WINDOW_DAYS = 21;

let blocked = false;
const now = Date.now();

for (const deadline of DEADLINES) {
	const at = Date.parse(deadline.date);
	const daysLeft = Math.ceil((at - now) / (24 * 60 * 60 * 1000));
	if (now >= at) {
		blocked = true;
		console.error(`\n[deadline] PAST DUE by ${Math.abs(daysLeft)} day(s): ${deadline.what}`);
		console.error(`           ${deadline.then}`);
		console.error(`           Or extend the date in tools/check-deadlines.cjs, in the commit that says why.\n`);
		continue;
	}
	if (daysLeft <= WARN_WINDOW_DAYS) {
		console.warn(`\n[deadline] ${daysLeft} day(s) left: ${deadline.what}`);
		console.warn(`           ${deadline.then}\n`);
	}
}

if (blocked) process.exit(1);
