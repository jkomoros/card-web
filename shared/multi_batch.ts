// Generic MultiBatchBase for auto-splitting Firestore batches at the 500-op
// limit. Parameterized with batch operations so it works with any SDK.

import {
	randomString
} from './util.js';

import {
	cardWriteViolation,
	nonBumpCardWriteViolation
} from './card-write-guard.js';

const FIRESTORE_BATCH_LIMIT = 500;
export const MULTI_BATCH_COMMIT_CONCURRENCY = 8;

// Configuration for SDK-specific batch operations
export interface MultiBatchConfig<TBatch, TRef> {
	createBatch: () => TBatch;
	batchSet: (batch: TBatch, ref: TRef, data: object, options?: object) => void;
	batchUpdate: (batch: TBatch, ref: TRef, data: object) => void;
	batchDelete: (batch: TBatch, ref: TRef) => void;
	commitBatch: (batch: TBatch) => Promise<void>;
	// Optional: preprocess data before writing (e.g. installServerTimestamps)
	preprocessData?: (data: object) => object;
	// Optional: count write operations for sentinel-heavy updates.
	// Returns the number of ops this update counts as (default: 1).
	writeCountForUpdate?: (update: object) => number;
	// Optional: enforce the `updated` write-invariant on top-level card docs
	// (docs/corpus-sync-design.md). When present, set/update THROW on a card
	// write that doesn't stamp updated with the SDK's serverTimestamp
	// sentinel, and updateWithoutTimestampBump only admits the reader-counter
	// allowlist. Hosted here in the BASE so both the client SDK MultiBatch
	// (src/multi_batch.ts) and the admin one (tools/mount.ts) enforce the
	// same policy — the invariant must not depend on which SDK writes.
	cardWriteGuard?: {
		cardsCollection: string;
		refPath: (ref: TRef) => string;
		isServerTimestampValue: (value: unknown) => boolean;
	};
}

//A logical MultiBatch can span several independent Firestore batches. Keep
//the partial-success information when one or more of those commits fail so
//callers can reconcile against the server instead of assuming an all-or-none
//outcome.
export class MultiBatchCommitError extends Error {
	readonly succeededBatchCount: number;
	readonly failedBatchCount: number;
	readonly reasons: unknown[];
	readonly succeededGroupIDs: string[];
	readonly failedGroupIDs: string[];

	constructor(succeededBatchCount: number, reasons: unknown[], succeededGroupIDs: string[] = [], failedGroupIDs: string[] = []) {
		const detail = reasons.length === 1 ? `: ${String(reasons[0])}` : '';
		super(`${reasons.length} of ${succeededBatchCount + reasons.length} Firestore batches failed${detail}`);
		this.name = 'MultiBatchCommitError';
		this.succeededBatchCount = succeededBatchCount;
		this.failedBatchCount = reasons.length;
		this.reasons = reasons;
		this.succeededGroupIDs = succeededGroupIDs;
		this.failedGroupIDs = failedGroupIDs;
	}
}

export class MultiBatchBase<TBatch, TRef> {

	protected _config: MultiBatchConfig<TBatch, TRef>;
	protected _currentBatchOperationCount: number;
	protected _currentBatch: TBatch | null;
	protected _batches: TBatch[];
	protected _id: string;
	protected _effectiveBatchLimit: number;
	protected _atomicGroup: {count: number, apply: (batch: TBatch) => void}[] | null;
	protected _atomicGroupID: string | null;
	protected _atomicBatches: {count: number, operations: {count: number, apply: (batch: TBatch) => void}[], groupIDs: string[]}[];

	constructor(config: MultiBatchConfig<TBatch, TRef>, effectiveBatchLimit: number = FIRESTORE_BATCH_LIMIT) {
		this._config = config;
		this._currentBatchOperationCount = 0;
		this._currentBatch = null;
		this._batches = [];
		this._id = randomString(8);
		this._effectiveBatchLimit = effectiveBatchLimit;
		this._atomicGroup = null;
		this._atomicGroupID = null;
		this._atomicBatches = [];
	}

	get batchID() {
		return this._id;
	}

	protected get _batch(): TBatch {
		if (this._currentBatchOperationCount >= this._effectiveBatchLimit) {
			this._currentBatch = null;
		}
		if (!this._currentBatch) {
			this._currentBatch = this._config.createBatch();
			this._batches.push(this._currentBatch);
			this._currentBatchOperationCount = 0;
		}
		return this._currentBatch;
	}

	protected _writeCountForUpdate(update: object): number {
		if (this._config.writeCountForUpdate) {
			return this._config.writeCountForUpdate(update);
		}
		return 1;
	}

	protected _queueOperation(count: number, apply: (batch: TBatch) => void) {
		if (this._atomicGroup) {
			this._atomicGroup.push({count, apply});
			return;
		}
		apply(this._batch);
		this._currentBatchOperationCount += count;
	}

	//Buffer a logical unit of writes until its total size is known. endAtomicGroup
	//then places the whole unit in one underlying Firestore batch, rolling to a
	//fresh batch first when necessary. This preserves the efficiency of packed
	//multi-card commits without ever bisecting one card's denormalized writes.
	beginAtomicGroup(groupID?: string) {
		if (this._atomicGroup) throw new Error('MultiBatch atomic groups cannot be nested');
		this._atomicGroup = [];
		this._atomicGroupID = groupID || null;
	}

	endAtomicGroup() {
		if (!this._atomicGroup) throw new Error('No MultiBatch atomic group is active');
		const operations = this._atomicGroup;
		const groupID = this._atomicGroupID;
		this._atomicGroup = null;
		this._atomicGroupID = null;
		const count = operations.reduce((total, operation) => total + operation.count, 0);
		if (count > this._effectiveBatchLimit) {
			//An edit whose denormalized fanout exceeds one Firestore batch (a
			//hub card with >~248 changed inbound references) cannot be
			//written atomically at all. Splitting is strictly better than
			//refusing (an earlier revision threw here, which made such cards
			//PERMANENTLY unsavable): the group's ID is attached to every
			//batch it spans, so a partial failure reports it in BOTH the
			//succeeded and failed lists and the recovery layer classifies
			//its cards as ambiguous and re-reads authoritative server state.
			for (const operation of operations) {
				let overflowTarget = this._atomicBatches[this._atomicBatches.length - 1];
				if (!overflowTarget || overflowTarget.count + operation.count > this._effectiveBatchLimit) {
					overflowTarget = {count: 0, operations: [], groupIDs: []};
					this._atomicBatches.push(overflowTarget);
				}
				overflowTarget.operations.push(operation);
				if (groupID && !overflowTarget.groupIDs.includes(groupID)) overflowTarget.groupIDs.push(groupID);
				overflowTarget.count += operation.count;
			}
			return;
		}
		if (!count) return;
		let target = this._atomicBatches[this._atomicBatches.length - 1];
		if (!target || target.count + count > this._effectiveBatchLimit) {
			target = {count: 0, operations: [], groupIDs: []};
			this._atomicBatches.push(target);
		}
		target.operations.push(...operations);
		if (groupID) target.groupIDs.push(groupID);
		target.count += count;
	}

	abortAtomicGroup() {
		if (!this._atomicGroup) return;
		this._atomicGroup = null;
		this._atomicGroupID = null;
	}

	delete(ref: TRef) {
		this._queueOperation(1, batch => this._config.batchDelete(batch, ref));
		return this;
	}

	protected _assertCardWriteAllowed(ref: TRef, data: object, noBump: boolean) {
		const guard = this._config.cardWriteGuard;
		if (!guard) return;
		const path = guard.refPath(ref);
		const violation = noBump
			? nonBumpCardWriteViolation(path, guard.cardsCollection, Object.keys(data))
			: cardWriteViolation(path, guard.cardsCollection, guard.isServerTimestampValue((data as {updated?: unknown}).updated));
		if (violation) throw new Error(violation);
	}

	set(ref: TRef, data: object, options?: object) {
		this._assertCardWriteAllowed(ref, data, false);
		if (this._config.preprocessData) {
			data = this._config.preprocessData(data);
		}
		const count = this._writeCountForUpdate(data);
		this._queueOperation(count, batch => this._config.batchSet(batch, ref, data, options));
		return this;
	}

	update(ref: TRef, data: object) {
		this._assertCardWriteAllowed(ref, data, false);
		if (this._config.preprocessData) {
			data = this._config.preprocessData(data);
		}
		const count = this._writeCountForUpdate(data);
		this._queueOperation(count, batch => this._config.batchUpdate(batch, ref, data));
		return this;
	}

	//The EXPLICIT, audited escape hatch for the reader-counter writers whose
	//rules branches forbid touching `updated` (see card-write-guard.ts's
	//allowlist). Throws if the write touches anything beyond the counters —
	//the hatch is not an opt-out for real content.
	updateWithoutTimestampBump(ref: TRef, data: object) {
		this._assertCardWriteAllowed(ref, data, true);
		if (this._config.preprocessData) {
			data = this._config.preprocessData(data);
		}
		const count = this._writeCountForUpdate(data);
		this._queueOperation(count, batch => this._config.batchUpdate(batch, ref, data));
		return this;
	}

	async commit(): Promise<void> {
		//Do not use Promise.all here. It rejects as soon as the first batch
		//fails, while the other independent commits can still be in flight. A
		//caller that immediately rolls back or refetches can then race those
		//late commits and "recover" to a state that was never authoritative.
		if (this._atomicGroup) throw new Error('Cannot commit while a MultiBatch atomic group is active');
		//Materialize every deferred atomic batch before starting ANY network
		//commit. Firestore's WriteBatch methods validate synchronously; if one
		//throws, its disposable batch (and every previously materialized batch)
		//is simply abandoned, so no prefix can leak to the server.
		const atomicBatches: TBatch[] = [];
		for (const pendingBatch of this._atomicBatches) {
			const batch = this._config.createBatch();
			for (const operation of pendingBatch.operations) operation.apply(batch);
			atomicBatches.push(batch);
		}
		const batches = [...this._batches, ...atomicBatches];
		const results: PromiseSettledResult<void>[] = new Array(batches.length);
		let nextBatchIndex = 0;
		const commitWorker = async () => {
			while (nextBatchIndex < batches.length) {
				const index = nextBatchIndex++;
				try {
					await this._config.commitBatch(batches[index]);
					results[index] = {status: 'fulfilled', value: undefined};
				} catch (reason) {
					results[index] = {status: 'rejected', reason};
				}
			}
		};
		await Promise.all(Array.from(
			{length: Math.min(MULTI_BATCH_COMMIT_CONCURRENCY, batches.length)},
			() => commitWorker(),
		));
		const reasons = results
			.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
			.map(result => result.reason);
		if (reasons.length) {
			const succeededGroupIDs: string[] = [];
			const failedGroupIDs: string[] = [];
			for (let index = 0; index < this._atomicBatches.length; index++) {
				const result = results[this._batches.length + index];
				const target = result.status === 'fulfilled' ? succeededGroupIDs : failedGroupIDs;
				target.push(...this._atomicBatches[index].groupIDs);
			}
			throw new MultiBatchCommitError(results.length - reasons.length, reasons, succeededGroupIDs, failedGroupIDs);
		}
	}
}
