//Pure helpers for recovering an optimistic card edit after Firestore rejects
//the logical commit. Kept separate from actions/data.ts so the concurrency
//rule can be unit-tested without Firebase or a browser.

import {
	Card,
	CardID,
	Cards,
} from './types.js';

//Restore a pre-write card unless a listener delivered a genuinely newer
//edit while our commit was pending (an unconditional restore would erase
//that edit locally, and the listener is not obliged to replay it). Two
//states mean the rollback is safe and NEEDED:
//- Redux holds the optimistic version (the echo applied): restore prior.
//- Redux still holds the exact prior object (the echo was enqueue-gated or
//  deduped away and never reached Redux): the rollback echo is a Redux
//  no-op but it enqueue-merges over the phantom optimistic entry still
//  sitting in the queue AND corrects the worker corpus, which applied the
//  optimistic echo unconditionally. Skipping here (as an earlier revision
//  did by comparing only against the optimistic version) let the phantom
//  flush later as if saved — and a retry then diffed against the phantom
//  and silently wrote nothing.
export const rollbackCardsStillOptimistic = (
	priorCards: Cards,
	optimisticCards: Cards,
	currentCards: Cards,
	equivalent: (a: Card, b: Card) => boolean,
): Cards => {
	const result: Cards = {};
	for (const [id, priorCard] of Object.entries(priorCards)) {
		const optimisticCard = optimisticCards[id];
		const currentCard = currentCards[id];
		if (!optimisticCard || !currentCard) continue;
		if (currentCard === priorCard || equivalent(currentCard, optimisticCard)) result[id] = priorCard;
	}
	return result;
};

//Classify materialized echo cards after split-batch outcomes. Cards touched
//only by failed atomic groups can be rolled back without a billed server read;
//only overlap between successful and failed groups is genuinely ambiguous.
export const recoveryIDsForGroupOutcomes = (
	echoIDsByGroup: {[groupID: string]: CardID[]},
	succeededGroupIDs: string[],
	failedGroupIDs: string[],
): {failedOnlyIDs: CardID[], ambiguousIDs: CardID[]} => {
	const succeeded = new Set(succeededGroupIDs);
	const failed = new Set(failedGroupIDs);
	const successfulAffected = new Set<CardID>();
	const failedAffected = new Set<CardID>();
	for (const [groupID, echoIDs] of Object.entries(echoIDsByGroup)) {
		const target = succeeded.has(groupID) ? successfulAffected : failed.has(groupID) ? failedAffected : null;
		if (target) for (const id of echoIDs) target.add(id);
	}
	return {
		ambiguousIDs: [...failedAffected].filter(id => successfulAffected.has(id)),
		failedOnlyIDs: [...failedAffected].filter(id => !successfulAffected.has(id)),
	};
};
