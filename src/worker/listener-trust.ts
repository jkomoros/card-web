//Firestore may materialize serverTimestamp() with the client clock while a
//write is pending. Neither cached snapshots nor pending documents may advance
//a durable query watermark/cursor.
export const listenerDocumentTrusted = (snapshotFromCache : boolean, hasPendingWrites : boolean) =>
	!snapshotFromCache && !hasPendingWrites;

//The marked ids a server-confirmed snapshot vouches for: a doc in its RESULT
//SET, with no pending local overlay, whose server `updated` equals the one
//the corpus holds — so the held copy IS the server image. The equality is
//what protects a held ECHO: the main thread echoes a save into the worker
//corpus at the base revision with a client-estimated `updated` while its
//write is still in flight, and the worker's own SDK instance has no pending
//write for it, so a server snapshot that merely lists that doc unchanged
//must not clear its mark (the review built this sequence; with a client
//clock ahead by more than the 5-minute margin, the next delta bound would
//skip real server writes).
//
//It must be the whole result set, not docChanges(): the first delivery
//after (re)attach comes from the SDK cache and marks every doc in it, and
//when that cache already matched the server the confirming snapshot carries
//NO changes — so a per-change clear never ran, the marks persisted into the
//compact snapshot, the next boot's watermark (derived over unmarked cards
//only) fell back to an older card, and the delta window grew to tens of
//thousands of docs per boot (#785: 21,804 marked ids and 42,904 re-read
//notes on DEV, ~22k on prod). Only MARKED ids are looked at, so once they
//are gone the walk costs nothing per delivery.
type ServerStamp = {seconds : number, nanoseconds : number} | undefined;
export const serverConfirmedIDs = (
	snapshot : {metadata : {fromCache : boolean}, docs : ReadonlyArray<{id : string, metadata : {hasPendingWrites : boolean}, get : (field : string) => unknown}>},
	marked : {size : number, has : (id : string) => boolean},
	heldUpdated : (id : string) => ServerStamp,
) : string[] => {
	if (snapshot.metadata.fromCache || !marked.size) return [];
	const ids : string[] = [];
	for (const doc of snapshot.docs) {
		if (doc.metadata.hasPendingWrites || !marked.has(doc.id)) continue;
		const held = heldUpdated(doc.id);
		const server = doc.get('updated') as ServerStamp;
		if (!held || !server || typeof server.seconds !== 'number') continue;
		if (held.seconds === server.seconds && held.nanoseconds === server.nanoseconds) ids.push(doc.id);
	}
	return ids;
};
