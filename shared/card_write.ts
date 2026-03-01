// Pure card write functions extracted from src/references.ts, src/card_diff.ts,
// and src/util.ts for use in both browser and server (admin SDK) contexts.
//
// Functions that need Firebase SDK-specific behavior (like deleteField sentinels)
// accept them as parameters so callers can provide the appropriate SDK version.

import {
	REFERENCE_TYPES,
	REFERENCE_TYPES_EQUIVALENCE_CLASSES,
	REFERENCES_INFO_CARD_PROPERTY,
	REFERENCES_INFO_INBOUND_CARD_PROPERTY,
	REFERENCES_CARD_PROPERTY,
	REFERENCES_INBOUND_CARD_PROPERTY,
} from './card_fields.js';

import {
	Card,
	CardID,
	CardDiff,
	ReferenceType,
	ReferencesInfoMap,
	ReferencesInfoMapByType,
	ReferencesArrayByType,
	CardBooleanMap,
	ExpandedReferenceKey,
	ExpandedReferenceObject,
	ExpandedReferenceDelete,
	ReferencesEntriesDiff,
	ReferencesEntriesDiffItem,
	ReferencesDiff,
	ReferencesCardsDiff,
	CardFlags,
	CardFlagsRemovals,
	cardFieldTypeEditableSchema,
} from './types.js';

import {
	TypedObject
} from './typed_object.js';

//--- SDK-agnostic types ---
//
// These mirror the types in src/types.ts but without depending on
// firebase/firestore FieldValue, so they can be used in any context.

//eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FirestoreLeafValue = boolean | string | number | object | any;

export type DottedCardUpdate = {
	[dottedPropertyName : string] : FirestoreLeafValue
};

export type CardUpdate = {
	[key : string] : unknown
} & DottedCardUpdate;

export type CardLike = Card | CardUpdate;

export type OptionalFieldsCard = Partial<Card>;

// Configuration for sentinel detection/creation. Different Firebase SDKs
// (client vs admin) have different sentinel implementations.
export interface SentinelConfig {
	deleteField: () => unknown;
	isDeleteSentinel: (val: unknown) => boolean;
	isServerTimestampSentinel: (val: unknown) => boolean;
	currentTimestamp: () => unknown;
}

// Default sentinel config that doesn't detect any sentinels (safe for
// contexts where sentinels won't appear in the data).
const NO_OP_SENTINELS: SentinelConfig = {
	deleteField: () => { throw new Error('deleteField not configured'); },
	isDeleteSentinel: () => false,
	isServerTimestampSentinel: () => false,
	currentTimestamp: () => new Date(),
};

//--- Constants ---

export const PERMISSION_EDIT_CARD = 'editCard';

//--- Array/Object Utilities (from src/util.ts) ---

export function arrayRemoveUtil<T>(arr : T[] | undefined, items : T[]) : T[] {
	if (!arr) arr = [];
	const itemsToRemove = new Map();
	for (const item of Object.values(items)) {
		itemsToRemove.set(item, true);
	}
	const result : T[] = [];
	for (const val of Object.values(arr)) {
		if (itemsToRemove.has(val)) continue;
		result.push(val);
	}
	return result;
}

export function arrayUnionUtil<T>(arr : T[] | undefined, items : T[]) : T[]{
	if (!arr) arr = [];
	const result = [];
	const seenItems = new Map();
	for (const val of Object.values(arr)) {
		seenItems.set(val, true);
		result.push(val);
	}
	for (const val of Object.values(items)) {
		if (seenItems.has(val)) continue;
		result.push(val);
	}
	return result;
}

export const applyCardFlags = (base? : CardFlags, setFlags? : CardFlags, removeFlags? : CardFlagsRemovals) : CardFlags => {
	const result = base ? {...base} : {};
	if (setFlags) {
		for (const flag of TypedObject.keys(setFlags)) {
			//eslint-disable-next-line @typescript-eslint/no-explicit-any
			result[flag] = setFlags[flag] as any;
		}
	}
	if (removeFlags) {
		for (const flag of TypedObject.keys(removeFlags)) {
			delete result[flag];
		}
	}
	return result;
};

//For {a: {b: 2}, c: 3}, a path of ['a', 'b'] would return 2.
export const getObjectPath = (obj : unknown, path : string[]) : unknown => {
	if (!path) return undefined;
	if (!Array.isArray(path)) return undefined;
	if (path.length == 0) return obj;
	if (!obj) return undefined;
	if (typeof obj !== 'object') return undefined;
	const stringKeyedObj = obj as {[field : string] : unknown};
	const modifiedPath = [...path];
	const firstPart = modifiedPath.shift();
	const subObject = firstPart === undefined ? undefined : stringKeyedObj[firstPart];
	return getObjectPath(subObject, modifiedPath);
};

//Returns a path within the given object to find an occurance of sentinel value.
export const objectPathToValue = (obj : unknown, sentinel : unknown) : string[] | undefined => {
	if (!obj) return undefined;
	if (typeof obj !== 'object') return undefined;
	for (const [key, value] of Object.entries(obj)) {
		if (value == sentinel) return [key];
		if (typeof value !== 'object') continue;
		const partialPath = objectPathToValue(value, sentinel);
		if (!partialPath) continue;
		return [key, ...partialPath];
	}
	return undefined;
};

//--- References Utilities (from src/references.ts) ---

const byTypeMapToArray = (byTypeMap : ReferencesInfoMapByType) : ReferencesArrayByType => {
	return Object.fromEntries(Object.entries(byTypeMap).map(entry => [entry[0], [...Object.keys(entry[1])]]));
};

export const referencesToByType = (referencesMap : ReferencesInfoMap) : ReferencesInfoMapByType => {
	const result : ReferencesInfoMapByType = {};
	if (!referencesMap) referencesMap = {};
	for (const [cardID, referenceBlock] of TypedObject.entries(referencesMap)) {
		for (const [referenceType, str] of TypedObject.entries(referenceBlock)) {
			if (!result[referenceType]) result[referenceType] = {};
			const obj = result[referenceType];
			if (!obj) throw new Error('Didn\'t set new obj as expected');
			obj[cardID] = str || '';
		}
	}
	return result;
};

export const byTypeToReferences = (byTypeMap : ReferencesInfoMapByType) : ReferencesInfoMap => {
	const result : ReferencesInfoMap = {};
	if (!byTypeMap) byTypeMap = {};
	for (const [referenceType, referenceBlock] of TypedObject.entries(byTypeMap)) {
		if (!referenceBlock) continue;
		for (const [cardID, str] of TypedObject.entries(referenceBlock)) {
			if (!result[cardID]) result[cardID] = {};
			result[cardID][referenceType] = str;
		}
	}
	return result;
};

export const cloneReferences = (referencesBlock : ReferencesInfoMap) : ReferencesInfoMap => {
	const result : ReferencesInfoMap = {};
	for (const [key, value] of Object.entries(referencesBlock)) {
		result[key] = {...value};
	}
	return result;
};

export const cloneReferencesBoolean = (referencesBlock : CardBooleanMap) : CardBooleanMap => {
	const result : CardBooleanMap = {};
	for (const [key, value] of Object.entries(referencesBlock)) {
		result[key] = value;
	}
	return result;
};

//referencesLegalShape is a sanity check that the referencesBlock looks like it's expected to.
export const referencesLegalShape = (cardObj : CardLike | null) : boolean => {
	if (!cardObj) return false;
	if (typeof cardObj !== 'object') return false;
	const referencesInfoBlock = (cardObj as Record<string, unknown>)[REFERENCES_INFO_CARD_PROPERTY] as ReferencesInfoMap | undefined;
	if (!referencesInfoBlock) return false;
	if (typeof referencesInfoBlock !== 'object') return false;
	if (Array.isArray(referencesInfoBlock)) return false;

	const referencesBlock = (cardObj as Record<string, unknown>)[REFERENCES_CARD_PROPERTY] as CardBooleanMap | undefined;
	if (!referencesBlock) return false;
	if (typeof referencesBlock !== 'object') return false;
	if (Array.isArray(referencesBlock)) return false;

	if (Object.keys(referencesInfoBlock).length === 0 && Object.keys(referencesBlock).length === 0) return true;

	if (Object.keys(referencesInfoBlock).length !== Object.keys(referencesBlock).length) return false;

	for (const [cardID, cardBlock] of Object.entries(referencesInfoBlock)) {
		if (!cardBlock) return false;
		if (typeof cardBlock !== 'object') return false;
		if (Array.isArray(cardBlock)) return false;
		if (Object.keys(cardBlock).length === 0) return false;
		for (const [key, value] of TypedObject.entries(cardBlock)) {
			if (!REFERENCE_TYPES[key]) return false;
			if (typeof value !== 'string') return false;
		}
		const referenceValue = referencesBlock[cardID];
		if (typeof referenceValue !== 'boolean') return false;
		if (!referenceValue) return false;
	}
	return true;
};

export const cardReferenceBlockHasDifference = (before : {[typ in ReferenceType]+?: string}, after: {[typ in ReferenceType]+?: string}) : boolean => {
	for(const linkType of TypedObject.keys(before)) {
		if (after[linkType] === undefined) return true;
		if (after[linkType] !== before[linkType]) return true;
	}
	for (const linkType of TypedObject.keys(after)) {
		if (before[linkType] === undefined) return true;
	}
	return false;
};

//--- ReferencesAccessor class ---

const memoizedCardAccessors = new WeakMap();

//Like references, but in a way that doesn't modify the card.
export const referencesNonModifying = (cardObj : CardLike) : ReferencesAccessor => {
	const cardCopy = {...cardObj};
	return references(cardCopy);
};

//References returns a ReferencesAccessor to access references for this cardObj.
export const references = (cardObj : CardLike | null) : ReferencesAccessor => {
	if (!cardObj) return new ReferencesAccessor({});
	let accessor = memoizedCardAccessors.get(cardObj);
	if (!accessor) {
		accessor = new ReferencesAccessor(cardObj);
		memoizedCardAccessors.set(cardObj, accessor);
	}
	return accessor;
};

export class ReferencesAccessor {

	protected _cardObj : CardLike;
	protected _modified : boolean;
	protected _memoizedByType : ReferencesInfoMapByType | null;
	protected _memoizedByTypeInbound : ReferencesInfoMapByType | null;
	protected _memoizedByTypeSubstantive : ReferencesInfoMapByType | null;
	protected _memoizedByTypeInboundSubstantive : ReferencesInfoMapByType | null;
	protected _referencesInfo : ReferencesInfoMap;
	protected _referencesInfoInbound : ReferencesInfoMap;

	constructor(cardObj : CardLike) {
		this._cardObj = cardObj;
		this._modified = false;
		this._memoizedByType = null;
		this._memoizedByTypeInbound = null;
		this._memoizedByTypeSubstantive = null;
		this._memoizedByTypeInboundSubstantive = null;
		this._referencesInfo = (cardObj as Record<string, unknown>)[REFERENCES_INFO_CARD_PROPERTY] as ReferencesInfoMap || {};
		this._referencesInfoInbound = (cardObj as Record<string, unknown>)[REFERENCES_INFO_INBOUND_CARD_PROPERTY] as ReferencesInfoMap || {};
	}

	linksArray() : CardID[] {
		return [...Object.keys(this.byType.link || {})];
	}

	substantiveArray() : CardID[] {
		return Object.keys(byTypeToReferences(this.byTypeSubstantive));
	}

	typeClassArray(baseType : ReferenceType) : CardID[] {
		return [...Object.keys(byTypeToReferences(this.byTypeClass(baseType)))];
	}

	array() : CardID[] {
		if (!this._referencesInfo) return [];
		return Object.keys(this._referencesInfo);
	}

	inboundNeedsReciprocationArray() : CardID[] {
		return [...Object.keys(byTypeToReferences(this.byTypeInboundNeedsReciprocation))];
	}

	inboundLinksArray() : CardID[] {
		return [...Object.keys(this.byTypeInbound.link || {})];
	}

	inboundSubstantiveArray() : CardID[] {
		return Object.keys(byTypeToReferences(this.byTypeInboundSubstantive));
	}

	inboundTypeClassArray(baseType : ReferenceType) : CardID[] {
		return [...Object.keys(byTypeToReferences(this.byTypeClassInbound(baseType)))];
	}

	inboundArray() : CardID[] {
		if (!this._referencesInfoInbound) return [];
		return Object.keys(this._referencesInfoInbound);
	}

	_cloneReferencesInfo() {
		const refs = (this._cardObj as Record<string, unknown>).references_info as ReferencesInfoMap | undefined;
		if (!refs) throw new Error('no refs');
		return cloneReferences(refs);
	}

	ensureReferences(otherCardObj : CardLike | null) {
		if (referencesLegalShape(this._cardObj)) return this;
		let referencesInfo = {};
		if (referencesLegalShape(otherCardObj)) {
			const otherCardObjNonNull = otherCardObj as CardLike;
			referencesInfo = references(otherCardObjNonNull)._cloneReferencesInfo();
		}
		this._setReferencesInfo(referencesInfo);
		return this;
	}

	get byType() : ReferencesInfoMapByType {
		if (!this._memoizedByType) {
			this._memoizedByType = referencesToByType(this._referencesInfo);
		}
		return this._memoizedByType;
	}

	get byTypeSubstantive() : ReferencesInfoMapByType {
		if (!this._memoizedByTypeSubstantive) {
			this._memoizedByTypeSubstantive = Object.fromEntries(TypedObject.entries(this.byType).filter(entry => (REFERENCE_TYPES[entry[0]] || {}).substantive));
		}
		return this._memoizedByTypeSubstantive;
	}

	byTypeClass(baseType : ReferenceType) : ReferencesInfoMapByType {
		return Object.fromEntries(TypedObject.entries(this.byType).filter(entry => REFERENCE_TYPES_EQUIVALENCE_CLASSES[baseType][entry[0]]));
	}

	get byTypeInbound() : ReferencesInfoMapByType {
		if (!this._memoizedByTypeInbound) {
			this._memoizedByTypeInbound = referencesToByType(this._referencesInfoInbound);
		}
		return this._memoizedByTypeInbound;
	}

	get byTypeInboundSubstantive() : ReferencesInfoMapByType {
		if (!this._memoizedByTypeInboundSubstantive) {
			this._memoizedByTypeInboundSubstantive = Object.fromEntries(TypedObject.entries(this.byTypeInbound).filter(entry => (REFERENCE_TYPES[entry[0]] || {}).substantive));
		}
		return this._memoizedByTypeInboundSubstantive;
	}

	get byTypeInboundNeedsReciprocation() : ReferencesInfoMapByType {
		return Object.fromEntries(TypedObject.entries(this.byTypeInbound).filter(entry => REFERENCE_TYPES[entry[0]].needsReciprocation));
	}

	byTypeClassInbound(baseType : ReferenceType) : ReferencesInfoMapByType {
		return Object.fromEntries(TypedObject.entries(this.byTypeInbound).filter(entry => REFERENCE_TYPES_EQUIVALENCE_CLASSES[baseType][entry[0]]));
	}

	byTypeArray() : ReferencesArrayByType {
		return byTypeMapToArray(this.byType);
	}

	byTypeInboundArray() : ReferencesArrayByType {
		return byTypeMapToArray(this.byTypeInbound);
	}

	_prepareForModifications() : void {
		if (this._modified) return;
		const cardObj = this._cardObj as Record<string, unknown>;
		cardObj.references_info = cloneReferences(cardObj.references_info as ReferencesInfoMap || {});
		cardObj.references = cloneReferencesBoolean(cardObj.references as CardBooleanMap || {});
		this._referencesInfo = cardObj[REFERENCES_INFO_CARD_PROPERTY] as ReferencesInfoMap;
		this._modified = true;
	}

	_modificationsFinished() : void {
		const cardObj = this._cardObj as Record<string, unknown>;
		cardObj.references = Object.fromEntries(Object.entries(cardObj.references_info as ReferencesInfoMap || {}).map(entry => [entry[0], true]));
		this._memoizedByType = null;
		this._memoizedByTypeInbound = null;
		this._memoizedByTypeSubstantive = null;
		this._memoizedByTypeInboundSubstantive = null;
		if (!referencesLegalShape(this._cardObj)) {
			throw new Error('References block set to something illegal');
		}
		this._modified = true;
	}

	_setReferencesInfo(referenceBlock : ReferencesInfoMap) : void {
		const cardObj = this._cardObj as Record<string, unknown>;
		cardObj[REFERENCES_INFO_CARD_PROPERTY] = referenceBlock;
		this._referencesInfo = referenceBlock;
		this._modificationsFinished();
	}

	_setWithByTypeReferences(byTypeReferenceBlock : ReferencesInfoMapByType) : void {
		this._setReferencesInfo(byTypeToReferences(byTypeReferenceBlock));
	}

	_applyEntryDiffItem(item : ReferencesEntriesDiffItem) : void {
		if (isExpandedReferenceDelete(item)) {
			this.removeCardReference(item.cardID, item.referenceType);
			return;
		}
		this.setCardReference(item.cardID, item.referenceType, item.value);
	}

	removeAllReferencesForCard(cardID : CardID) : void {
		this._prepareForModifications();
		delete this._referencesInfo[cardID];
		this._modificationsFinished();
	}

	applyEntriesDiff(diff : ReferencesEntriesDiff) : void {
		for (const item of diff) {
			this._applyEntryDiffItem(item);
		}
	}

	setCardReference(cardID : CardID, referenceType : ReferenceType, optValue? : string) : void {
		if (!optValue) optValue = '';
		this._prepareForModifications();
		if (!this._referencesInfo[cardID]) this._referencesInfo[cardID] = {};
		this._referencesInfo[cardID][referenceType] = optValue;
		this._modificationsFinished();
	}

	removeCardReference(cardID : CardID, referenceType : ReferenceType) : void {
		if (!this._referencesInfo[cardID]) return;
		if (this._referencesInfo[cardID][referenceType] === undefined) return;
		this._prepareForModifications();
		delete this._referencesInfo[cardID][referenceType];
		if (Object.keys(this._referencesInfo[cardID]).length === 0) {
			delete this._referencesInfo[cardID];
		}
		this._modificationsFinished();
	}

	setCardReferencesOfType(referenceType : ReferenceType, valueObj : CardID[] | {[id : CardID] : string}) : void {
		this._modifyCardReferencesOfType(referenceType, valueObj, true);
	}

	addCardReferencesOfType(referenceType : ReferenceType, valueObj: CardID[] | {[id : CardID] : string}) : void {
		this._modifyCardReferencesOfType(referenceType, valueObj, false);
	}

	_modifyCardReferencesOfType(referenceType : ReferenceType, valueObj : CardID[] | {[id : CardID] : string}, overwrite? : boolean) : void {
		const byType = this.byType;
		if (typeof valueObj !== 'object' || !valueObj) {
			throw new Error('valueObj not object or array');
		}
		const mapObj = Array.isArray(valueObj) ? Object.fromEntries(Object.values(valueObj).map(id => [id, ''])) : valueObj;
		byType[referenceType] = overwrite ? {...mapObj} : {...(byType[referenceType] || {}), ...mapObj};
		this._setWithByTypeReferences(byType);
	}

	setLinks(linksObj: {[id : CardID]: string}) : void {
		this.setCardReferencesOfType('link', linksObj);
	}

	equivalentTo(otherCardObj : CardLike) : boolean {
		const diff = referencesCardsDiff(this._cardObj, otherCardObj);
		return diff.every(item => Object.keys(item).length === 0);
	}

	withFallbackText(fallbackMap? : ReferencesInfoMap) : ReferencesAccessor {
		if (!fallbackMap) fallbackMap = {};
		const newCardLikeObj = {...this._cardObj};
		const newReferences = new ReferencesAccessor(newCardLikeObj);
		newReferences.ensureReferences(this._cardObj);

		for (const [cardID, referenceMap] of Object.entries(this._referencesInfo)) {
			for (const [referenceType, str] of TypedObject.entries(referenceMap)) {
				if (str) continue;
				if (!fallbackMap[cardID]) continue;
				if (!fallbackMap[cardID][referenceType]) continue;
				newReferences.setCardReference(cardID, referenceType, fallbackMap[cardID][referenceType]);
			}
		}

		return newReferences;
	}
}

//--- References diff functions ---

export function isExpandedReferenceDelete(obj : ExpandedReferenceObject | ExpandedReferenceDelete) : obj is ExpandedReferenceDelete {
	return (obj as ExpandedReferenceDelete).delete != undefined;
}

const expandedReferenceKey = (cardID : CardID, referenceType : ReferenceType) : ExpandedReferenceKey => cardID + '+' + referenceType;
const expandedReferenceObject = (cardID : CardID, referenceType : ReferenceType, value : string) : ExpandedReferenceObject => ({
	cardID,
	referenceType,
	value,
});
const expandedReferenceDeleteObject = (cardID : CardID, referenceType : ReferenceType) : ExpandedReferenceDelete => ({
	cardID,
	referenceType,
	delete: true,
});

const expandedReferences = (referencesInfo : ReferencesInfoMap) : {[key : ExpandedReferenceKey]: ExpandedReferenceObject} => {
	const result : {[key : ExpandedReferenceKey] : ExpandedReferenceObject} = {};
	for (const [cardID, cardRefs] of Object.entries(referencesInfo)) {
		for (const [referenceType, value] of TypedObject.entries(cardRefs)) {
			const key = expandedReferenceKey(cardID, referenceType);
			const obj = expandedReferenceObject(cardID, referenceType, value || '');
			result[key] = obj;
		}
	}
	return result;
};

export const referencesEntriesDiff = (beforeCard : CardLike, afterCard : CardLike) : ReferencesEntriesDiff => {
	const modificationsResult = [];
	const deletionsResult = [];
	if (!referencesLegalShape(beforeCard)) return [];
	if (!referencesLegalShape(afterCard)) return [];
	const before = (beforeCard as Record<string, unknown>).references_info as ReferencesInfoMap || {};
	const after = (afterCard as Record<string, unknown>).references_info as ReferencesInfoMap || {};
	const expandedBefore = expandedReferences(before);
	const expandedAfter = expandedReferences(after);
	const seenInAfter : {[key : ExpandedReferenceKey] : true} = {};
	for (const [key, afterObj] of Object.entries(expandedAfter)) {
		seenInAfter[key] = true;
		const beforeObjValue = expandedBefore[key] ? expandedBefore[key].value : undefined;
		if (beforeObjValue !== afterObj.value) modificationsResult.push(afterObj);
	}
	for (const [key, beforeObj] of Object.entries(expandedBefore)) {
		if (seenInAfter[key]) continue;
		deletionsResult.push(expandedReferenceDeleteObject(beforeObj.cardID, beforeObj.referenceType));
	}
	return [...deletionsResult, ...modificationsResult];
};

export const referencesDiff = (beforeCard : CardLike, afterCard : CardLike) : ReferencesDiff => {
	const result : ReferencesDiff = [{}, {}, {}, {}];
	if (!referencesLegalShape(beforeCard)) return result;
	if (!referencesLegalShape(afterCard)) return result;
	const before = (beforeCard as Record<string, unknown>)[REFERENCES_INFO_CARD_PROPERTY] as ReferencesInfoMap || {};
	const after = (afterCard as Record<string, unknown>)[REFERENCES_INFO_CARD_PROPERTY] as ReferencesInfoMap || {};

	const cardAdditions : CardBooleanMap = {};
	const cardSame : CardBooleanMap = {};
	const cardDeletions : CardBooleanMap = {};
	for (const cardID of Object.keys(before)) {
		if (after[cardID]) {
			cardSame[cardID] = true;
		} else {
			cardDeletions[cardID] = true;
		}
	}
	for (const cardID of Object.keys(after)) {
		if (!before[cardID]) {
			cardAdditions[cardID] = true;
		}
	}

	for (const cardID of Object.keys(cardAdditions)) {
		for (const [key, value] of Object.entries(after[cardID])) {
			result[0][cardID + '.' + key] = value;
		}
	}

	for (const cardID of Object.keys(cardSame)) {
		const beforeCardBlock = before[cardID];
		const afterCardBlock = after[cardID];

		const keyAdditions : {[typ in ReferenceType]+?: true} = {};
		const keySame : {[typ in ReferenceType]+?: true} = {};
		const keyDeletions : {[typ in ReferenceType]+?: true} = {};
		for (const key of TypedObject.keys(beforeCardBlock)) {
			if (afterCardBlock[key] === undefined) {
				keyDeletions[key] = true;
			} else {
				keySame[key] = true;
			}
		}
		for (const key of TypedObject.keys(afterCardBlock)) {
			if (beforeCardBlock[key] === undefined) {
				keyAdditions[key] = true;
			}
		}

		for (const key of TypedObject.keys(keyAdditions)) {
			result[0][cardID + '.' + key] = afterCardBlock[key] || '';
		}

		for (const key of TypedObject.keys(keyDeletions)) {
			result[2][cardID + '.' + key] = true;
		}

		for (const key of TypedObject.keys(keySame)) {
			if (beforeCardBlock[key] === afterCardBlock[key]) continue;
			result[1][cardID + '.' + key] = afterCardBlock[key] || '';
		}
	}

	result[3] = cardDeletions;

	return result;
};

export const referencesCardsDiff = (beforeCard : CardLike | null, afterCard : CardLike | null) : ReferencesCardsDiff => {
	const result : ReferencesCardsDiff = [{}, {}];
	const emptyCard = {[REFERENCES_INFO_CARD_PROPERTY]:{}, [REFERENCES_CARD_PROPERTY]: {}};
	if (!beforeCard || Object.keys(beforeCard).length === 0) beforeCard = emptyCard;
	if (!afterCard || Object.keys(afterCard).length === 0) afterCard = emptyCard;
	if (!referencesLegalShape(beforeCard)) return result;
	if (!referencesLegalShape(afterCard)) return result;
	const before = (beforeCard as Record<string, unknown>).references_info as ReferencesInfoMap || {};
	const after = (afterCard as Record<string, unknown>).references_info as ReferencesInfoMap || {};
	const cardSame : CardBooleanMap = {};
	for (const cardID of Object.keys(before)) {
		if (after[cardID]) {
			cardSame[cardID] = true;
		} else {
			result[1][cardID] = true;
		}
	}
	for (const cardID of Object.keys(after)) {
		if (!before[cardID]) {
			result[0][cardID] = true;
		}
	}

	for (const cardID of Object.keys(cardSame)) {
		if (cardReferenceBlockHasDifference(before[cardID], after[cardID])) result[0][cardID] = true;
	}

	return result;
};

// applyReferencesDiff generates modifications to go from beforeCard's
// references to afterCard's references, accumulating them on update.
// deleteFieldSentinel is a value that will mark fields for deletion in the
// Firestore update (e.g. deleteField() from client SDK or FieldValue.delete()
// from admin SDK).
export const applyReferencesDiff = (beforeCard : CardLike, afterCard : CardLike, update : CardUpdate, deleteFieldSentinel : unknown) => {
	if (!update) update = {};
	const [additions, modifications, leafDeletions, cardDeletions] = referencesDiff(beforeCard, afterCard);
	for (const [key, val] of Object.entries(additions)) {
		const parts = key.split('.');
		const cardID = parts[0];
		update[REFERENCES_INFO_CARD_PROPERTY + '.' + key] = val;
		update[REFERENCES_CARD_PROPERTY + '.' + cardID] = true;
	}
	for (const [key, val] of Object.entries(modifications)) {
		update[REFERENCES_INFO_CARD_PROPERTY + '.' + key] = val;
	}
	for (const key of Object.keys(leafDeletions)) {
		update[REFERENCES_INFO_CARD_PROPERTY + '.' + key] = deleteFieldSentinel;
	}
	for (const key of Object.keys(cardDeletions)) {
		update[REFERENCES_INFO_CARD_PROPERTY + '.' + key] = deleteFieldSentinel;
		update[REFERENCES_CARD_PROPERTY + '.' + key] = deleteFieldSentinel;
	}
	return update;
};

//--- Card diff functions (from src/card_diff.ts) ---

export const cardDiffHasChanges = (diff : CardDiff) : boolean => {
	if (!diff) return false;
	return Object.keys(diff).length > 0;
};

export const cardDiffDescription = (diff : CardDiff) : string => {
	if (!cardDiffHasChanges(diff)) return '';
	return JSON.stringify(diff, null, 2);
};

// setFirebaseValueOnObj applies a single value at a dotted path in an object,
// handling sentinel values via the provided sentinels config.
export const setFirebaseValueOnObj = (obj : {[field : string]: unknown}, fieldParts : string[], value : FirestoreLeafValue, sentinels : SentinelConfig = NO_OP_SENTINELS) => {
	const firstFieldPart = fieldParts[0];
	if (fieldParts.length == 1) {
		if (sentinels.isDeleteSentinel(value)) {
			delete obj[firstFieldPart];
			return;
		}
		if (sentinels.isServerTimestampSentinel(value)) {
			obj[firstFieldPart] = sentinels.currentTimestamp();
			return;
		}
		obj[firstFieldPart] = value;
		return;
	}
	const newObj = obj[firstFieldPart] && typeof obj[firstFieldPart] == 'object' ? {...(obj[firstFieldPart] as object)} : {};
	obj[firstFieldPart] = newObj;
	setFirebaseValueOnObj(newObj, fieldParts.slice(1), value, sentinels);
};

// applyCardFirebaseUpdate takes a firebaseUpdate and applies it to baseCard
// to generate a new cloned card. FirebaseUpdates may have dotted-string keys
// and sentinel values.
export const applyCardFirebaseUpdate = (baseCard : Card, firebaseUpdate : CardUpdate, sentinels : SentinelConfig = NO_OP_SENTINELS) : Card => {
	const result = {...baseCard};
	for (const [key, value] of Object.entries(firebaseUpdate)) {
		setFirebaseValueOnObj(result, key.split('.'), value, sentinels);
	}
	return result;
};

// cardFromDiff applies a diff to a card and returns the result.
export const cardFromDiff = (underlyingCard : Card, diff : CardDiff, deleteFieldSentinel : unknown = undefined, sentinels : SentinelConfig = NO_OP_SENTINELS) : Card => {
	return applyCardFirebaseUpdate(underlyingCard, applyCardDiff(underlyingCard, diff, deleteFieldSentinel), sentinels);
};

// applyCardDiff returns a CardUpdate object with only the fields that change
// in diff. deleteFieldSentinel is used for reference deletions.
export const applyCardDiff = (underlyingCard : Card, diff : CardDiff, deleteFieldSentinel : unknown = undefined) : CardUpdate => {

	const cardUpdateObject : CardUpdate = {};

	for (const field of cardFieldTypeEditableSchema.options) {
		if (diff[field] === undefined) continue;
		cardUpdateObject[field] = diff[field];
	}

	if (diff.references_diff !== undefined) {
		const cardCopy = {...underlyingCard};
		const refs = references(cardCopy);
		refs.applyEntriesDiff(diff.references_diff);
		applyReferencesDiff(underlyingCard, cardCopy, cardUpdateObject, deleteFieldSentinel);
	}

	if (diff.notes !== undefined) {
		cardUpdateObject.notes = diff.notes;
	}

	if (diff.todo !== undefined) {
		cardUpdateObject.todo = diff.todo;
	}

	if (diff.published !== undefined) {
		cardUpdateObject.published = diff.published;
	}

	if (diff.font_size_boost !== undefined) {
		cardUpdateObject.font_size_boost = diff.font_size_boost;
	}

	if (diff.images !== undefined) {
		cardUpdateObject.images = diff.images;
	}

	if (diff.name !== undefined) {
		cardUpdateObject.name = diff.name;
	}

	if (diff.sort_order !== undefined) {
		cardUpdateObject.sort_order = diff.sort_order;
	}

	if (diff.section !== undefined) {
		cardUpdateObject.section = diff.section;
	}

	if (diff.card_type !== undefined) {
		cardUpdateObject.card_type = diff.card_type;
	}

	if (diff.full_bleed !== undefined) {
		cardUpdateObject.full_bleed = diff.full_bleed;
	}

	if (diff.set_flags || diff.remove_flags) {
		cardUpdateObject.flags = applyCardFlags(underlyingCard.flags, diff.set_flags, diff.remove_flags);
	}

	if (diff.add_tags || diff.remove_tags) {
		let tags = underlyingCard.tags;
		if (diff.remove_tags) {
			tags = arrayRemoveUtil(tags, diff.remove_tags);
		}
		if (diff.add_tags) {
			tags = arrayUnionUtil(tags, diff.add_tags);
		}
		cardUpdateObject.tags = tags;
	}

	if (diff.add_editors || diff.remove_editors) {
		let editors = underlyingCard.permissions[PERMISSION_EDIT_CARD] || [];
		if (diff.remove_editors) editors = arrayRemoveUtil(editors, diff.remove_editors);
		if (diff.add_editors) {
			editors = arrayUnionUtil(editors, diff.add_editors);
		}
		cardUpdateObject['permissions.' + PERMISSION_EDIT_CARD] = editors;
	}

	if (diff.add_collaborators || diff.remove_collaborators) {
		let collaborators = underlyingCard.collaborators;
		if (diff.remove_collaborators) collaborators = arrayRemoveUtil(collaborators, diff.remove_collaborators);
		if (diff.add_collaborators) collaborators = arrayUnionUtil(collaborators, diff.add_collaborators);
		cardUpdateObject.collaborators = collaborators;
	}

	if (diff.auto_todo_overrides_enablements || diff.auto_todo_overrides_disablements || diff.auto_todo_overrides_removals) {
		const overrides = {...underlyingCard.auto_todo_overrides || {}};
		if (diff.auto_todo_overrides_enablements) diff.auto_todo_overrides_enablements.forEach(key => overrides[key] = true);
		if (diff.auto_todo_overrides_disablements) diff.auto_todo_overrides_disablements.forEach(key => overrides[key] = false);
		if (diff.auto_todo_overrides_removals) diff.auto_todo_overrides_removals.forEach(key => delete overrides[key]);
		cardUpdateObject.auto_todo_overrides = overrides;
	}

	return cardUpdateObject;
};

// inboundLinksUpdates computes Firestore updates needed on other cards'
// inbound references when a card's outbound references change.
// deleteFieldSentinel should be the SDK-appropriate delete sentinel value.
export const inboundLinksUpdates = (cardID : CardID, beforeCard : CardLike | null, afterCard : CardLike, deleteFieldSentinel : unknown) : {[id : CardID] : DottedCardUpdate } => {

	const [changes, deletions] = referencesCardsDiff(beforeCard, afterCard);

	if (Object.keys(changes).length === 0 && Object.keys(deletions).length === 0) return {};

	const updatesToApply : {[id : CardID] : DottedCardUpdate } = {};

	if (Object.keys(changes).length) {
		const afterReferencesInfo = (afterCard as Record<string, unknown>)[REFERENCES_INFO_CARD_PROPERTY] as ReferencesInfoMap || {};
		const afterReferences = (afterCard as Record<string, unknown>)[REFERENCES_CARD_PROPERTY] as CardBooleanMap || {};
		for (const otherCardID of Object.keys(changes)) {
			const update : DottedCardUpdate = {
				[REFERENCES_INFO_INBOUND_CARD_PROPERTY + '.' + cardID]: afterReferencesInfo[otherCardID],
				[REFERENCES_INBOUND_CARD_PROPERTY + '.' + cardID]: afterReferences[otherCardID],
			};
			updatesToApply[otherCardID] = update;
		}
	}

	for (const otherCardID of Object.keys(deletions)) {
		const update : DottedCardUpdate = {
			[REFERENCES_INFO_INBOUND_CARD_PROPERTY + '.' + cardID]: deleteFieldSentinel,
			[REFERENCES_INBOUND_CARD_PROPERTY + '.' + cardID]: deleteFieldSentinel,
		};
		updatesToApply[otherCardID] = update;
	}

	return updatesToApply;
};
