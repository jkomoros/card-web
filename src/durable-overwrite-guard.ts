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
//JSON.stringify is KEY-ORDER SENSITIVE, and the two copies being compared do
//not share one: server-stored images come back as
//{position, height, src, width, emSize, uploadPath, alt, margin}, while
//client-constructed ones go through {...DEFAULT_IMAGE, ...img} and come out
//{src, emSize, margin, width, height, position, uploadPath, ...}. A base
//recorded from the client-shaped copy — which is what a local echo writes into
//Redux after a save — therefore compared UNEQUAL to the identical server value,
//bringing the bogus "changed elsewhere" refusal back for a second consecutive
//images save. Serialize with sorted keys so only values matter. Arrays keep
//their order, which is right: image order is meaningful.
//R15-7: order-insensitivity was not enough, because the two copies do not share
//a key SET either. An image block recorded as a base before a field was added
//to the client's image defaults lacks that key entirely, while the server copy
//carries it at its default — so the guard reported "changed elsewhere" for a
//difference that is not content, and the user could not resolve it by editing
//anything. A key that is ABSENT on one side and CONTENTLESS on the other is the
//same content.
//
//Deliberately conservative about what counts as contentless: only the empty
//form of a type. A field that holds real text on one side and is missing on the
//other is still a conflict, which is the case that actually destroys work.
const contentless = (value : unknown) : boolean => {
	if (value === undefined || value === null || value === '' || value === false || value === 0) return true;
	if (Array.isArray(value)) return value.length === 0;
	if (typeof value === 'object') return Object.keys(value as object).length === 0;
	return false;
};

//Recursively drop contentless OBJECT entries so two copies with different key
//sets but the same content compare equal. Array elements are NOT dropped:
//images are positional, so removing an empty one would shift every index after
//it and could hide a real reordering.
const canonical = (value : unknown) : unknown => {
	if (Array.isArray(value)) return value.map(canonical);
	if (value === null || typeof value !== 'object') return value;
	const result : {[key : string] : unknown} = {};
	for (const [key, inner] of Object.entries(value as {[key : string] : unknown})) {
		const canonicalInner = canonical(inner);
		if (contentless(canonicalInner)) continue;
		result[key] = canonicalInner;
	}
	return result;
};

const stableSerialize = (value : unknown) : string => {
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
	if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
	const entries = Object.entries(value as {[key : string] : unknown}).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
	return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${stableSerialize(inner)}`).join(',')}}`;
};

const sameFieldValue = (left : unknown, right : unknown) : boolean => {
	if (left === right) return true;
	//The whole-field version of the key-set problem: a base recorded before the
	//field existed holds `undefined` (and, after the localStorage round trip,
	//loses the key entirely) where the server holds the field's empty value.
	//Neither carries content, so neither can be overwritten.
	if (contentless(left) && contentless(right)) return true;
	if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
	try {
		return stableSerialize(canonical(left)) === stableSerialize(canonical(right));
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
