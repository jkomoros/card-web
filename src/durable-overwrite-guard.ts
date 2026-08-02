//Zero-import policy core for the durable multi-edit's overwrite guard, kept
//separate from src/actions/data.ts so it can be unit tested without the browser
//Firebase runtime — the same split shared/card-write-guard.ts uses.
//
//The hazard it exists for: a durable multi-edit record can be resumed hours or
//days after it was written, automatically, on any readiness edge or `online`
//event. Its CardDiff replaces whole values for text fields, so replaying it
//over content saved in between — from another device, or another tab —
//destroys that content silently. The interactive save path has always warned
//about this; the resume path had no equivalent.

//The CardDiff fields that REPLACE a value outright, as opposed to merging into
//it (add_tags, references_diff and friends are additive and always safe to
//replay). Lives here rather than in card_diff.ts so this module stays a leaf.
export const NON_AUTOMATIC_MERGE_FIELDS : {[cardDiffField : string]: true} = {
	title : true,
	title_alternates : true,
	body : true,
	subtitle : true,
	todo : true,
	notes : true,
	external_link: true,
	images : true,
};

export type OverwriteConflict = {
	id : string,
	fields : string[]
};

//The fields of `update` worth recording as a base: only those that can destroy
//content. An additive multi-edit records nothing at all.
export const replacedFieldsOf = (update : object) : string[] =>
	Object.keys(update).filter(field => NON_AUTOMATIC_MERGE_FIELDS[field]);

//Which of `chunkIDs` would have content REPLACED by applying `update`, given
//what each card held when the operation was planned (`baseFields`) and what the
//server holds now (`serverCards`).
//
//Deliberately compares VALUES rather than the `updated` timestamp. Redux's copy
//of `updated` after a local echo is a client estimate rather than the server's
//own, so a timestamp comparison flags an ordinary second save of the same card
//as a conflict. Values are also self-evident for a partially-committed chunk:
//the server already equals what we would write, so nothing is at risk.
//`images` and `title_alternates` are ARRAYS, and two arrays are never ===, so
//identity comparison reported every image edit as "changed elsewhere" and
//refused the save. Compare by value for anything non-primitive. Order matters
//for these fields (images are positional), so serialization is the right
//comparison rather than set equality.
const sameFieldValue = (left : unknown, right : unknown) : boolean => {
	if (left === right) return true;
	if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
	try {
		return JSON.stringify(left) === JSON.stringify(right);
	} catch {
		//Cyclic or otherwise unserializable: fall back to "not equal", which
		//errs toward asking the user rather than silently overwriting.
		return false;
	}
};

export const overwrittenCardFields = (
	update : {[field : string] : unknown},
	baseFields : {[id : string] : {[field : string] : unknown}} | undefined,
	serverCards : {[id : string] : {[field : string] : unknown} | undefined},
	chunkIDs : string[]
) : OverwriteConflict[] => {
	//No recorded base means an operation persisted before this guard existed.
	//It must stay resumable rather than become permanently stuck.
	if (!baseFields) return [];
	const result : OverwriteConflict[] = [];
	for (const id of chunkIDs) {
		const recorded = baseFields[id];
		const card = serverCards[id];
		if (!recorded || !card) continue;
		const fields = Object.keys(recorded).filter(field => {
			//Unchanged since we planned: safe.
			if (sameFieldValue(card[field], recorded[field])) return false;
			//Already equal to what we would write — our own partially-committed
			//chunk, or someone who happened to make the identical edit.
			if (sameFieldValue(card[field], update[field])) return false;
			return true;
		});
		if (fields.length) result.push({id, fields});
	}
	return result;
};

//The message shown when a resume is refused. Exported so the retry path can
//recognize its own paused conflict without matching loose prose.
export const OVERWRITE_CONFLICT_PREFIX = 'Changed elsewhere after you saved:';

export const overwriteConflictMessage = (conflicts : OverwriteConflict[]) : string =>
	`${OVERWRITE_CONFLICT_PREFIX} ${conflicts.map(entry => `${entry.id} (${entry.fields.join(', ')})`).join('; ')}. Retrying replaces those changes with yours; Stop discards your pending save instead.`;
