//An oversized denormalized card edit spans independent Firestore batches.
//Its durable completion marker must never race those batches: if even one
//fanout batch fails, the persisted recovery base remains and no marker may
//tell a later session that the logical edit completed.
export interface Committable {
	commit() : Promise<void>;
}

export const commitFanoutThenMarker = async (
	fanout : Committable,
	marker : Committable | null,
) : Promise<void> => {
	await fanout.commit();
	if (marker) await marker.commit();
};
