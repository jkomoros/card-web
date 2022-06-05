import {
	deleteField
} from 'firebase/firestore';

import {
	Card,
	CardID,
	ReferenceType,
	ReferencesArrayByType,
	ReferencesInfoMap,
	ReferencesInfoMapByType,
	ExpandedReferenceKey,
	ExpandedReferenceDelete,
	ExpandedReferenceObject,
	ReferencesEntriesDiff,
	CardUpdate,
	CardLike,
	ReferencesEntriesDiffItem,
	State,
	CardBooleanMap,
	ReferencesDiff,
	ReferencesCardsDiff
} from './types.js';

import {
	REFERENCES_INFO_CARD_PROPERTY,
	REFERENCES_INFO_INBOUND_CARD_PROPERTY,
	REFERENCE_TYPE_LINK,
	REFERENCE_TYPES,
	REFERENCES_CARD_PROPERTY,
	REFERENCE_TYPES_EQUIVALENCE_CLASSES,
} from './card_fields.js';

import {
	getCardType,
	getCardExists
} from './card_exists.js';

const memoizedCardAccessors = new WeakMap();

//Like referendces, but in a way that doesn't modify the card. It simply creates
//a shallow copy of the card first.
export const referencesNonModifying = (cardObj : CardLike) => {
	const cardCopy = {...cardObj};
	//TODO: return the same copy for the same object
	return references(cardCopy);
};

//References returns a ReferencesAccessor to access references for this cardObj.
//It may return one that's already been returned for this card obj.
export const references = (cardObj : CardLike) => {
	let accessor = memoizedCardAccessors.get(cardObj);
	if (!accessor) {
		accessor = new ReferencesAccessor(cardObj);
		memoizedCardAccessors.set(cardObj, accessor);
	}
	return accessor;
};

const byTypeMapToArray = (byTypeMap : ReferencesInfoMapByType) : ReferencesArrayByType => {
	return Object.fromEntries(Object.entries(byTypeMap).map(entry => [entry[0], [...Object.keys(entry[1])]]));
};

const referencesToByType = (referencesMap : ReferencesInfoMap) : ReferencesInfoMapByType => {
	let result : ReferencesInfoMapByType = {};
	if (!referencesMap) referencesMap = {};
	for (const [cardID, referenceBlock] of Object.entries(referencesMap)) {
		for (const [referenceType, str] of Object.entries(referenceBlock)) {
			if (!result[referenceType]) result[referenceType] = {};
			result[referenceType][cardID] = str;
		}
	}
	return result;
};

const byTypeToReferences = (byTypeMap : ReferencesInfoMapByType) : ReferencesInfoMap => {
	const result : ReferencesInfoMap = {};
	if (!byTypeMap) byTypeMap = {};
	for (let [referenceType, referenceBlock] of Object.entries(byTypeMap)) {
		for (let [cardID, str] of Object.entries(referenceBlock)) {
			if (!result[cardID]) result[cardID] = {};
			result[cardID][referenceType] = str;
		}
	}
	return result;
};

class ReferencesAccessor {

	private _cardObj : CardLike;
	private _modified : boolean;
	private _memoizedByType : ReferencesInfoMapByType;
	private _memoizedByTypeInbound : ReferencesInfoMapByType;
	private _memoizedByTypeSubstantive : ReferencesInfoMapByType;
	private _memoizedByTypeInboundSubstantive : ReferencesInfoMapByType;
	private _referencesInfo : ReferencesInfoMap;
	private _referencesInfoInbound : ReferencesInfoMap;

	//ReferencesAccessor assumes that, if you do one of the mutating methods,
	//it's legal to modify cardObj, but NOT the previously set reference blocks.
	//(That is, that cardObj is a mutable shallow copy from any state objects).
	//If you modify anything, it will overwrite the references blocks instead of
	//modifying them.
	constructor(cardObj : CardLike) {
		this._cardObj = cardObj;
		this._modified = false;
		this._memoizedByType = null;
		this._memoizedByTypeInbound = null;
		this._memoizedByTypeSubstantive = null;
		this._memoizedByTypeInboundSubstantive = null;
		this._referencesInfo = cardObj[REFERENCES_INFO_CARD_PROPERTY] || {};
		this._referencesInfoInbound = cardObj[REFERENCES_INFO_INBOUND_CARD_PROPERTY] || {};
	}

	linksArray() {
		//NOTE: similar manual logic is duplicated manually in tweets-helper.js
		return [...Object.keys(this.byType[REFERENCE_TYPE_LINK] || {})];
	}

	substantiveArray() {
		return Object.keys(byTypeToReferences(this.byTypeSubstantive));
	}

	typeClassArray(baseType : ReferenceType) {
		return [...Object.keys(byTypeToReferences(this.byTypeClass(baseType)))];
	}

	//ALL references as an array. You typically want substantiveArray, which is only the substantive references.
	array() {
		if (!this._referencesInfo) return [];
		return Object.keys(this._referencesInfo);
	}

	inboundNeedsReciprocationArray() {
		return [...Object.keys(byTypeToReferences(this.byTypeInboundNeedsReciprocation))];
	}

	inboundLinksArray() {
		return [...Object.keys(this.byTypeInbound[REFERENCE_TYPE_LINK] || {})];
	}

	inboundSubstantiveArray() {
		return Object.keys(byTypeToReferences(this.byTypeInboundSubstantive));
	}

	inboundTypeClassArray(baseType : ReferenceType) {
		return [...Object.keys(byTypeToReferences(this.byTypeClassInbound(baseType)))];
	}

	//ALL inbound references as an array. You typically want inboundSubstantiveArray, which is only the substantive references.
	inboundArray() {
		if (!this._referencesInfoInbound) return [];
		return Object.keys(this._referencesInfoInbound);
	}

	_cloneReferencesInfo() {
		return cloneReferences(this._cardObj[REFERENCES_INFO_CARD_PROPERTY]);
	}

	//ensureReferences ensures that the cardObj we're associated with has valid
	//references. If it doesn, and otherCardObj does, it clones it from there.
	//If otherCardObj doesn't and we don't as well, then we set the trivial
	//empty reerences. Returns itself for convenience in chaining.
	ensureReferences(otherCardObj : CardLike) {
		if (referencesLegalShape(this._cardObj)) return this;
		let referencesInfo = {};
		if (referencesLegalShape(otherCardObj)) {
			referencesInfo = references(otherCardObj)._cloneReferencesInfo();
		}
		this._setReferencesInfo(referencesInfo);
		return this;
	}

	//returns a new map where each key in the top level is the type, and the second level objects are card-id to string value.
	get byType() : ReferencesInfoMapByType {
		if (!this._memoizedByType) {
			this._memoizedByType = referencesToByType(this._referencesInfo);
		}
		return this._memoizedByType;
	}

	get byTypeSubstantive() : ReferencesInfoMapByType {
		if (!this._memoizedByTypeSubstantive) {
			this._memoizedByTypeSubstantive = Object.fromEntries(Object.entries(this.byType).filter(entry => (REFERENCE_TYPES[entry[0]] || {}).substantive));
		}
		return this._memoizedByTypeSubstantive;
	}

	byTypeClass(baseType : ReferenceType) : ReferencesInfoMapByType {
		return Object.fromEntries(Object.entries(this.byType).filter(entry => REFERENCE_TYPES_EQUIVALENCE_CLASSES[baseType][entry[0]]));
	}

	//returns a new map where each key in the top level is the type, and the second level objects are card-id to string value.
	get byTypeInbound() : ReferencesInfoMapByType {
		if (!this._memoizedByTypeInbound) {
			this._memoizedByTypeInbound = referencesToByType(this._referencesInfoInbound);
		}
		return this._memoizedByTypeInbound;
	}

	get byTypeInboundSubstantive() : ReferencesInfoMapByType {
		if (!this._memoizedByTypeInboundSubstantive) {
			this._memoizedByTypeInboundSubstantive = Object.fromEntries(Object.entries(this.byTypeInbound).filter(entry => (REFERENCE_TYPES[entry[0]] || {}).substantive));
		}
		return this._memoizedByTypeInboundSubstantive;
	}

	get byTypeInboundNeedsReciprocation() : ReferencesInfoMapByType {
		return Object.fromEntries(Object.entries(this.byTypeInbound).filter(entry => REFERENCE_TYPES[entry[0]].needsReciprocation));
	}

	byTypeClassInbound(baseType : ReferenceType) : ReferencesInfoMapByType {
		return Object.fromEntries(Object.entries(this.byTypeInbound).filter(entry => REFERENCE_TYPES_EQUIVALENCE_CLASSES[baseType][entry[0]]));
	}

	//Returns an object where it's link_type => array_of_card_ids
	byTypeArray() : ReferencesArrayByType {
		//Generally it should be that if it's a method it returns a copy, if it's a getter it returns a shared resource
		return byTypeMapToArray(this.byType);
	}

	//Returns an object where it's link_type => array_of_card_ids
	byTypeInboundArray() : ReferencesArrayByType {
		return byTypeMapToArray(this.byTypeInbound);
	}

	//We're allowed to modify the card object we're associated with, but NOT its
	//inner refrence properties. If we want to touch them, we have to copy them
	//over from their original values.
	_prepareForModifications() : void {
		if (this._modified) return;
		this._cardObj[REFERENCES_INFO_CARD_PROPERTY] = cloneReferences(this._cardObj[REFERENCES_INFO_CARD_PROPERTY]);
		this._cardObj[REFERENCES_CARD_PROPERTY] = cloneReferencesBoolean(this._cardObj[REFERENCES_CARD_PROPERTY]);
		this._referencesInfo = this._cardObj[REFERENCES_INFO_CARD_PROPERTY];
		this._modified = true;
	}

	_modificationsFinished() : void {
		this._cardObj[REFERENCES_CARD_PROPERTY] = Object.fromEntries(Object.entries(this._cardObj[REFERENCES_INFO_CARD_PROPERTY]).map(entry => [entry[0], true]));
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
		//We set these directly and don't use prepareForModifications because we'll just blow away all of the changes anyway.
		this._cardObj[REFERENCES_INFO_CARD_PROPERTY] = referenceBlock;
		this._referencesInfo = referenceBlock;
		this._modificationsFinished();
	}

	//Consumes a referenceBlock organized by type (e.g. as received by byType)
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

	_mayNotApplyEntryDiffItemReason(state : State, item : ReferencesEntriesDiffItem) : string {
		if (isExpandedReferenceDelete(item)) return this.mayNotRemoveCardReferenceReason(state, item.cardID, item.referenceType);
		return this.mayNotSetCardReferenceReason(state, item.cardID, item.referenceType);
	}

	//Removes all references for the given card.
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

	mayNotApplyEntriesDiffReason(state : State, diff : ReferencesEntriesDiff) : string {
		//We have to actually apply them one by one, since some might conflict
		//with others in the diff, so we'll do it on a copy.
		const referencesCopy = references({...this._cardObj});
		let i = 0;
		//Deletions will come first in the diff, which is useful, because some
		//of the deletions might resolve conflicts later.
		for (const item of diff) {
			const reason = referencesCopy._mayNotApplyEntryDiffItemReason(state, item);
			if (reason) {
				return 'The ' + i + ' diff item could not be applied: ' + reason;
			}
			referencesCopy._applyEntryDiffItem(item);
			i++;
		}
		return '';
	}

	setCardReference(cardID : CardID, referenceType : ReferenceType, optValue? : string) : void {
		if (!optValue) optValue = '';
		this._prepareForModifications();
		if (!this._referencesInfo[cardID]) this._referencesInfo[cardID] = {};
		this._referencesInfo[cardID][referenceType] = optValue;
		this._modificationsFinished();
	}

	//Returns a string describing why that reference may not be set, or '' if
	//it's legal.
	mayNotRemoveCardReferenceReason(state : State, cardID : CardID, referenceType : ReferenceType) : string {
		if (!getCardExists(state, cardID)) {
			return 'The other card is not known to exist, which means we wouldn\'t be able to update its inboundLinks.';
		}
		if (!this._referencesInfo[cardID]) {
			return 'No references exist to that card';
		}
		if (this._referencesInfo[cardID][referenceType] === undefined) {
			return 'A reference of that type to that card does not exist';
		}
		return '';
	}

	//Returns a string describing why that reference may not be set, or '' if
	//it's legal.
	mayNotSetCardReferenceReason(state : State, cardID : CardID, referenceType : ReferenceType) : string {

		if (this._cardObj.id == cardID) {
			return 'The card references itself which is not allowed';
		}

		if (!getCardExists(state, cardID)) {
			return 'No such card known to exist on the client';
		}

		const toCardType = getCardType(state, cardID);
		const referenceTypeConfig = REFERENCE_TYPES[referenceType];

		if (!referenceTypeConfig) {
			return 'Illegal referenceType: ' + referenceType;
		}
		
		const baseType = referenceTypeConfig.subTypeOf || referenceType;

		if (REFERENCE_TYPES_EQUIVALENCE_CLASSES[baseType][referenceType] && this.typeClassArray(baseType).some(id => id == cardID)) {
			return 'The editing card already has a ' + baseType + ' reference (or subtype) to that card';
		}
	
		//if the reference type doesn't have a toCardTypeAllowList then any of them
		//are legal.
		if (referenceTypeConfig.toCardTypeAllowList) {
			if (!referenceTypeConfig.toCardTypeAllowList[toCardType]) {
				return 'That reference type may not point to cards of type ' + toCardType;
			}
		}
	
		if (referenceTypeConfig.fromCardTypeAllowList) {
			if (!referenceTypeConfig.fromCardTypeAllowList[this._cardObj.card_type]) {
				return 'That reference type may not originate from cards of type ' + this._cardObj.card_type;
			}
		}

		return '';
	}

	removeCardReference(cardID : CardID, referenceType : ReferenceType) : void {
		if (!this._referencesInfo[cardID]) return;
		//Leaf values might be '', which are falsey but should count as being set
		if (this._referencesInfo[cardID][referenceType] === undefined) return;
		this._prepareForModifications();
		delete this._referencesInfo[cardID][referenceType];
		if (Object.keys(this._referencesInfo[cardID]).length === 0) {
			delete this._referencesInfo[cardID];
		}
		this._modificationsFinished();
	}

	//Sets it so that all references of that type will be set to the values in
	//valueObj. valueObj may be a map of CARD_ID -> str value, or it may be an
	//array of CARD_IDs.
	setCardReferencesOfType(referenceType : ReferenceType, valueObj : CardID[] | {[id : CardID] : string}) : void {
		this._modifyCardReferencesOfType(referenceType,valueObj, true);
	}

	//Like setCardReferencesOfType but doesn't remove existing values
	addCardReferencesOfType(referenceType : ReferenceType, valueObj: CardID[] | {[id : CardID] : string}) : void {
		this._modifyCardReferencesOfType(referenceType,valueObj, false);
	}

	_modifyCardReferencesOfType(referenceType : ReferenceType, valueObj : CardID[] | {[id : CardID] : string}, overwrite? : boolean) : void {
		const byType = this.byType;
		if (typeof valueObj !== 'object' || !valueObj) {
			throw new Error('valueObj not object or array');
		}
		const mapObj = Array.isArray(valueObj) ? Object.fromEntries(Object.values(valueObj).map(id => [id, ''])) : valueObj;
		//Yes, we're modifying the byType, but will be removed immediately anyway
		byType[referenceType] = overwrite ? {...mapObj} : {...(byType[referenceType] || {}), ...mapObj};
		this._setWithByTypeReferences(byType);
	}

	//linksObj should be a cardID -> str value map. It will replace all
	//currently set references of the current type. A simple wrapper around
	//setCardReferencesOfType with the constant for links burned in
	setLinks(linksObj: {[id : CardID]: string}) : void {
		this.setCardReferencesOfType(REFERENCE_TYPE_LINK, linksObj);
	}

	equivalentTo(otherCardObj : CardLike) : boolean {
		const diff = referencesCardsDiff(this._cardObj, otherCardObj);
		return diff.every(item => Object.keys(item).length === 0);
	}
	
	//withFallbackText returns a new referencesAccesor based on this one, but
	//where any outbound references we have that had an empty text value will be
	//set to the given value in fallbackText, if it exists. fallbackMap is a map
	//of CardID to (ReferenceType -> string)
	withFallbackText(fallbackMap : ReferencesInfoMap) : ReferencesAccessor {
		if (!fallbackMap) fallbackMap = {};
		//First, effectively clone the references object we're based on, by
		//creating a fake card (which won't ever be accesible)
		const newCardLikeObj = {...this._cardObj};
		const newReferences = new ReferencesAccessor(newCardLikeObj);
		newReferences.ensureReferences(this._cardObj);

		//Now, go through each reference type and see if any are missing.
		for (let [cardID, referenceMap] of Object.entries(this._referencesInfo)) {
			for (let [referenceType, str] of Object.entries(referenceMap)) {
				if (str) continue;
				//if we get to here, there's a gap. See if anything in the fallbackMap fills it.
				if (!fallbackMap[cardID]) continue;
				if (!fallbackMap[cardID][referenceType]) continue;
				newReferences.setCardReference(cardID, referenceType, fallbackMap[cardID][referenceType]);
			}
		}

		return newReferences;
	}
};

//Returns a card-like object with a reference block that is the UNION of the
//references of all cardObjs provided. See also intersectionReferences.
export const unionReferences = (cardObjs : Card[]) : CardLike => {
	const fauxCard = {};
	const refs = references(fauxCard);
	refs.ensureReferences(null);
	for (const card of cardObjs) {
		const referencesInfo = card[REFERENCES_INFO_CARD_PROPERTY];
		for (const [cardID, cardReferences] of Object.entries(referencesInfo)) {
			for (const [referenceType, value] of Object.entries(cardReferences)) {
				refs.setCardReference(cardID, referenceType, value);
			}
		}
	}
	return fauxCard;
};

//Returns a card-like object with a reference block that is the INTERSECTION of the
//references of all cardObjs provided. See also unionReferences.
export const intersectionReferences = (cardObjs : Card[]) : CardLike => {
	const fauxCard = {};
	const refs = references(fauxCard);
	const firstCard = cardObjs.length ? cardObjs[0] : null;
	refs.ensureReferences(firstCard);
	const fauxCardReferencesInfo = fauxCard[REFERENCES_INFO_CARD_PROPERTY];
	//skip the first card, which we basically copied, and remove everything else.
	for (const card of cardObjs.slice(1)){
		const referencesInfo = card[REFERENCES_INFO_CARD_PROPERTY];
		for (const [cardID, cardReferences] of Object.entries(referencesInfo)) {
			for (const referenceType of Object.keys(cardReferences)) {
				//Leave items that we have.
				if (fauxCardReferencesInfo[cardID] && fauxCardReferencesInfo[cardID][referenceType] !== undefined) continue;
				refs.removeCardReference(cardID, referenceType);
			}
		}
		//Now remove any items from first that the others don't have
		for (const [cardID, cardReferences] of Object.entries(fauxCardReferencesInfo)) {
			for (const referenceType of Object.keys(cardReferences)) {
				//Leave items that we have.
				if (referencesInfo[cardID] && referencesInfo[cardID][referenceType] !== undefined) continue;
				refs.removeCardReference(cardID, referenceType);
			}
		}
	}
	return fauxCard;
};

//referencesLegalShape is a sanity check that the referencesBlock looks like it's expected to.
export const referencesLegalShape = (cardObj : CardLike) : boolean => {
	if (!cardObj) return false;
	if (typeof cardObj !== 'object') return false;
	const referencesInfoBlock = cardObj[REFERENCES_INFO_CARD_PROPERTY];
	if (!referencesInfoBlock) return false;
	if (typeof referencesInfoBlock !== 'object') return false;
	if (Array.isArray(referencesInfoBlock)) return false;

	const referencesBlock = cardObj[REFERENCES_CARD_PROPERTY];
	if (!referencesBlock) return false;
	if (typeof referencesBlock !== 'object') return false;
	if (Array.isArray(referencesBlock)) return false;

	//It's OK for it to have no keys.
	if (Object.keys(referencesInfoBlock).length === 0 && Object.keys(referencesBlock).length === 0) return true;

	if (Object.keys(referencesInfoBlock).length !== Object.keys(referencesBlock).length) return false;

	for (let [cardID, cardBlock] of Object.entries(referencesInfoBlock)) {
		if (!cardBlock) return false;
		if (typeof cardBlock !== 'object') return false;
		if (Array.isArray(cardBlock)) return false;
		//If a card block is empty is shouldn't exist
		if (Object.keys(cardBlock).length === 0) return false;
		for (let [key, value] of Object.entries(cardBlock)) {
			//The only types of keys that are allowed are the explicitly defined reference types
			if (!REFERENCE_TYPES[key]) return false;
			if (typeof value !== 'string') return false;
		}
		let referenceValue = referencesBlock[cardID];
		if (typeof referenceValue !== 'boolean') return false;
		//only true is allowed, since it shows that an object exists at that key in references_info
		if (!referenceValue) return false;
	}
	return true;
};

const cloneReferencesBoolean = (referencesBlock : CardBooleanMap) : CardBooleanMap => {
	let result : CardBooleanMap = {};
	for (let [key, value] of Object.entries(referencesBlock)) {
		//e.g. a boolean
		result[key] = value;
	}
	return result;
};


const cloneReferences = (referencesBlock : ReferencesInfoMap) : ReferencesInfoMap => {
	let result : ReferencesInfoMap = {};
	for (let [key, value] of Object.entries(referencesBlock)) {
		result[key] = {...value};
	}
	return result;
};

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

//Returns an object where keys look like `CARD_ID+REFERENCE_TYPE` and values
//look like {cardID: 'CARD_ID', referenceType: 'REFERENCE_TYPE', value:''}
const expandedReferences = (referencesInfo : ReferencesInfoMap) : {[key : ExpandedReferenceKey]: {cardID : CardID, referenceType : ReferenceType, value : string}}=> {
	const result : {[key : ExpandedReferenceKey] : ExpandedReferenceObject} = {};
	for (const [cardID, cardRefs] of Object.entries(referencesInfo)) {
		for (const [referenceType, value] of Object.entries(cardRefs)) {
			const key = expandedReferenceKey(cardID, referenceType);
			const obj = expandedReferenceObject(cardID, referenceType, value);
			result[key] = obj;
		}
	}
	return result;
};

export function isExpandedReferenceDelete(obj : ExpandedReferenceObject | ExpandedReferenceDelete) : obj is ExpandedReferenceDelete {
	return (obj as ExpandedReferenceDelete).delete != undefined;
}

const referencesEntriesDiffWithoutItem = (diff : ReferencesEntriesDiff = [], cardID : CardID, referenceType : ReferenceType, isDelete : boolean) : ReferencesEntriesDiff => {
	return diff.filter(item => {
		if (item.cardID != cardID) return false;
		if (item.referenceType != referenceType) return false;
		if (isExpandedReferenceDelete(item) != isDelete) return false;
		return true;
	});
};

//Adds an entry to set the given item. If the diff had a remove command for that
//cardID/referenceType already, it removes it instead.
export const referencesEntriesDiffWithSet = (diff : ReferencesEntriesDiff = [], cardID : CardID, referenceType : ReferenceType, value : string = '') : ReferencesEntriesDiff => {
	const trimmedDiff = referencesEntriesDiffWithoutItem(diff, cardID, referenceType, true);
	if (trimmedDiff.length < diff.length) return trimmedDiff;
	return [...diff, expandedReferenceObject(cardID, referenceType, value)];
};

//Adds an entry to remove the given item. If the diff had a set command for that
//cardID/referenceType already, it removes it instead.
export const referencesEntriesDiffWithRemove = (diff : ReferencesEntriesDiff = [], cardID : CardID, referenceType : ReferenceType) : ReferencesEntriesDiff => {
	const trimmedDiff = referencesEntriesDiffWithoutItem(diff, cardID, referenceType, false);
	if (trimmedDiff.length < diff.length) return trimmedDiff;
	return [expandedReferenceDeleteObject(cardID, referenceType), ...diff];
};

//Returns an array of objects with referenceType, cardID, and either value or
//delete:true, representing the items that would have to be done via
//setCardReference and removeCardReference to get beforeCard to look like
//afterCard. The deletions will all come before the modifications in the diff.
export const referencesEntriesDiff = (beforeCard : CardLike, afterCard : CardLike) : ReferencesEntriesDiff => {
	const modificationsResult = [];
	const deletionsResult = [];
	if (!referencesLegalShape(beforeCard)) return [];
	if (!referencesLegalShape(afterCard)) return [];
	const before = beforeCard[REFERENCES_INFO_CARD_PROPERTY];
	const after = afterCard[REFERENCES_INFO_CARD_PROPERTY];
	const expandedBefore = expandedReferences(before);
	const expandedAfter = expandedReferences(after);
	const seenInAfter = {};
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

//Returns a 4-tuple of [additions, modifications, leafDeletions, cardDeletions].
//Each one is a dotted property name. If a given cardDeletion is included, then
//no leafDeletions that start with that CARD_ID will be included. Additions will
//not create new card objects, it will assume the dotted accesor that implies it
//in the path will create it.
export const referencesDiff = (beforeCard : CardLike, afterCard : CardLike) : ReferencesDiff => {
	const result : ReferencesDiff = [{}, {}, {}, {}];
	if (!referencesLegalShape(beforeCard)) return result;
	if (!referencesLegalShape(afterCard)) return result;
	const before = beforeCard[REFERENCES_INFO_CARD_PROPERTY];
	const after = afterCard[REFERENCES_INFO_CARD_PROPERTY];
	//For cards that were not in before but are in after
	let cardAdditions : CardBooleanMap = {};
	//For card blocks that exist in both before and after... but might have modifications within them
	let cardSame : CardBooleanMap = {};
	//For card blocks that are not in after but were in before.
	let cardDeletions : CardBooleanMap = {};
	for (let cardID of Object.keys(before)) {
		if (after[cardID]) {
			cardSame[cardID] = true;
		} else {
			cardDeletions[cardID] = true;
		}
	}
	for (let cardID of Object.keys(after)) {
		if (!before[cardID]) {
			cardAdditions[cardID] = true;
		}
	}

	for (let cardID of Object.keys(cardAdditions)) {
		//All of the properties in the cardID block are additions.
		for (let [key, value] of Object.entries(after[cardID])) {
			result[0][cardID + '.' + key] = value;
		}
	}

	//NOTE: this logic can assume that if all of the keys for a card were
	//deleted, the cardID block also was, since referencesLegalShape validates that.

	//Now look at the cardBlocks that exist in both and compare the leaf values
	//to see what changed.
	for (let cardID of Object.keys(cardSame)) {
		let beforeCardBlock = before[cardID];
		let afterCardBlock = after[cardID];

		//Whether keys exist (even if the string value for them is different) in
		//before and after.
		let keyAdditions : CardBooleanMap= {};
		let keySame : CardBooleanMap = {};
		let keyDeletions : CardBooleanMap = {};
		for (let key of Object.keys(beforeCardBlock)) {
			if (afterCardBlock[key] === undefined) {
				keyDeletions[key] = true;
			} else {
				keySame[key] = true;
			}
		}
		for (let key of Object.keys(afterCardBlock)) {
			if (beforeCardBlock[key] === undefined) {
				keyAdditions[key] = true;
			}
		}

		for (let key of Object.keys(keyAdditions)) {
			result[0][cardID + '.' + key] = afterCardBlock[key];
		}

		for (let key of Object.keys(keyDeletions)) {
			result[2][cardID + '.' + key] = true;
		}

		for (let key of Object.keys(keySame)) {
			if (beforeCardBlock[key] === afterCardBlock[key]) continue;
			result[1][cardID + '.' + key] = afterCardBlock[key];
		}
	}

	result[3] = cardDeletions;

	return result;
};

const cardReferenceBlockHasDifference = (before : {[typ : ReferenceType] : string}, after: {[typ : ReferenceType] : string}) : boolean => {
	for(let linkType of Object.keys(before)) {
		if (after[linkType] === undefined) return true;
		if (after[linkType] !== before[linkType]) return true;
	}
	for (let linkType of Object.keys(after)) {
		if (before[linkType] === undefined) return true;
	}
	return false;
};

//Inspired by referencesDiff from card_fields.js Returns
//[cardIDAdditionsOrModifications, cardIDDeletions]. each is a map of cardID =>
//true, and say that you should copy over the whole block.
export const referencesCardsDiff = (beforeCard : CardLike, afterCard : CardLike) : ReferencesCardsDiff => {
	const result : ReferencesCardsDiff = [{}, {}];
	const emptyCard = {[REFERENCES_INFO_CARD_PROPERTY]:{}, [REFERENCES_CARD_PROPERTY]: {}};
	if (!beforeCard || Object.keys(beforeCard).length === 0) beforeCard = emptyCard;
	if (!afterCard || Object.keys(afterCard).length === 0) afterCard = emptyCard;
	if (!referencesLegalShape(beforeCard)) return result;
	if (!referencesLegalShape(afterCard)) return result;
	const before = beforeCard[REFERENCES_INFO_CARD_PROPERTY];
	const after = afterCard[REFERENCES_INFO_CARD_PROPERTY];
	//For card blocks that exist in both before and after... but might have modifications within them
	let cardSame : CardBooleanMap = {};
	for (let cardID of Object.keys(before)) {
		if (after[cardID]) {
			cardSame[cardID] = true;
		} else {
			result[1][cardID] = true;
		}
	}
	for (let cardID of Object.keys(after)) {
		if (!before[cardID]) {
			result[0][cardID] = true;
		}
	}

	//For cards that are bin both before and after, are there any things that changed?
	for (let cardID of Object.keys(cardSame)) {
		if (cardReferenceBlockHasDifference(before[cardID], after[cardID])) result[0][cardID] = true;
	}

	return result;
};

//applyReferencesDiff will generate the modifications necessary to go from
//references_info.before to references_info.after, and accumulate them IN PLACE as keys on
//update, including using deleteField. update should be a cardUpdateObject,
//so the keys this sets will have references_info. This also sets the necessary keys
//on references. prepended. update object is also returned as a
//convenience.
export const applyReferencesDiff = (beforeCard : Card, afterCard : Card, update : CardUpdate) => {
	if (!update) update = {};
	let [additions, modifications, leafDeletions, cardDeletions] = referencesDiff(beforeCard,afterCard);
	for (let [key, val] of Object.entries(additions)) {
		let parts = key.split('.');
		let cardID = parts[0];
		update[REFERENCES_INFO_CARD_PROPERTY + '.' + key] = val;
		update[REFERENCES_CARD_PROPERTY + '.' + cardID] = true;
	}
	for (let [key, val] of Object.entries(modifications)) {
		update[REFERENCES_INFO_CARD_PROPERTY + '.' + key] = val;
	}
	for (let key of Object.keys(leafDeletions)) {
		update[REFERENCES_INFO_CARD_PROPERTY + '.' + key] = deleteField();
	}
	for (let key of Object.keys(cardDeletions)) {
		update[REFERENCES_INFO_CARD_PROPERTY + '.' + key] = deleteField();
		update[REFERENCES_CARD_PROPERTY + '.' + key] = deleteField();
	}
	return update;
};