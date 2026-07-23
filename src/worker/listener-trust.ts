//Firestore may materialize serverTimestamp() with the client clock while a
//write is pending. Neither cached snapshots nor pending documents may advance
//a durable query watermark/cursor.
export const listenerDocumentTrusted = (snapshotFromCache : boolean, hasPendingWrites : boolean) =>
	!snapshotFromCache && !hasPendingWrites;
