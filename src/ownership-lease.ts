export type OwnershipLease = {
	version: 1,
	tabID: string,
	epoch: number,
	heartbeatAt: number,
	dirty: boolean,
	pending: boolean,
};

export type HeartbeatDecision = 'skip' | 'write' | 'deactivate';

export const nextOwnershipLease = (
	tabID : string,
	currentEpoch : number,
	prior : OwnershipLease | null,
	heartbeatAt : number,
	safety : Pick<OwnershipLease, 'dirty' | 'pending'>,
) : OwnershipLease => ({
	version: 1,
	tabID,
	epoch: Math.max(currentEpoch, prior?.epoch || 0) + 1,
	heartbeatAt,
	...safety,
});

//A missing lease means durable storage is unavailable; the held Web Lock is
//still authoritative. Any present foreign token means this page was
//superseded and must stop before it can overwrite that token.
export const heartbeatDecision = (
	active : boolean,
	localTabID : string,
	localEpoch : number,
	lease : OwnershipLease | null,
) : HeartbeatDecision => {
	if (!active || !localEpoch) return 'skip';
	if (lease && (lease.tabID !== localTabID || lease.epoch !== localEpoch)) return 'deactivate';
	return 'write';
};

export const leaseBelongsTo = (lease : OwnershipLease | null, tabID : string, epoch : number) =>
	!lease || (lease.tabID === tabID && lease.epoch === epoch);
