/*eslint-env node*/

import assert from 'assert';

import {heartbeatDecision, leaseBelongsTo, nextOwnershipLease} from '../../lib/src/ownership-lease.js';

const lease = (tabID, epoch) => ({
	version: 1,
	tabID,
	epoch,
	heartbeatAt: 100,
	dirty: false,
	pending: false,
});

describe('ownership heartbeat fencing', () => {
	it('deactivates instead of overwriting a forced-takeover epoch', () => {
		assert.equal(heartbeatDecision(true, 'old', 4, lease('new', 5)), 'deactivate');
		assert.equal(leaseBelongsTo(lease('new', 5), 'old', 4), false);
	});

	it('also rejects a foreign token with the same or older epoch', () => {
		assert.equal(heartbeatDecision(true, 'old', 4, lease('new', 4)), 'deactivate');
		assert.equal(heartbeatDecision(true, 'old', 4, lease('new', 3)), 'deactivate');
	});

	it('writes only while the local token remains authoritative', () => {
		assert.equal(heartbeatDecision(true, 'owner', 7, lease('owner', 7)), 'write');
		assert.equal(heartbeatDecision(true, 'owner', 7, null), 'write');
		assert.equal(heartbeatDecision(false, 'owner', 7, lease('owner', 7)), 'skip');
	});

	it('claims a newer durable epoch before a reloaded page starts its heartbeat', () => {
		const claim = nextOwnershipLease('reload', 0, lease('old-page', 7), 200, {dirty: false, pending: false});
		assert.deepEqual(claim, {
			version: 1,
			tabID: 'reload',
			epoch: 8,
			heartbeatAt: 200,
			dirty: false,
			pending: false,
		});
		assert.equal(heartbeatDecision(true, claim.tabID, claim.epoch, claim), 'write');
	});
});
