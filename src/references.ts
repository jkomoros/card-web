import {
	deleteField
} from 'firebase/firestore';

import {
	TypedObject
} from '../shared/typed_object.js';

import {
	Card,
	CardID,
	ReferenceType,
	ReferencesEntriesDiff,
	CardUpdate,
	CardLike,
	ReferencesEntriesDiffItem,
	State,
} from './types.js';

import {
	REFERENCE_TYPES,
	REFERENCE_TYPES_EQUIVALENCE_CLASSES,
	REFERENCES_INFO_CARD_PROPERTY,
} from '../shared/card_fields.js';

import {
	getCardType,
	getCardExists
} from './card_exists.js';

// Re-export everything from the shared module for backwards compatibility
export {
	referencesToByType,
	byTypeToReferences,
	cloneReferences,
	cloneReferencesBoolean,
	referencesLegalShape,
	cardReferenceBlockHasDifference,
	referencesDiff,
	referencesCardsDiff,
	referencesEntriesDiff,
	isExpandedReferenceDelete,
	ReferencesAccessor as ReferencesAccessorBase,
} from '../shared/card_write.js';

import {
	ReferencesAccessor as ReferencesAccessorBase,
	isExpandedReferenceDelete,
	applyReferencesDiff as sharedApplyReferencesDiff,
} from '../shared/card_write.js';


// Extended ReferencesAccessor with State-dependent validation methods
class ReferencesAccessorFull extends ReferencesAccessorBase {

	_mayNotApplyEntryDiffItemReason(state : State, item : ReferencesEntriesDiffItem) : string {
		if (isExpandedReferenceDelete(item)) return this.mayNotRemoveCardReferenceReason(state, item.cardID, item.referenceType);
		return this.mayNotSetCardReferenceReason(state, item.cardID, item.referenceType, item.value);
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
	mayNotSetCardReferenceReason(state : State, cardID : CardID, referenceType : ReferenceType, value : string) : string {

		if (!value) value = '';

		if ((this._cardObj as Card).id == cardID) {
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
			const currentValue = this._referencesInfo[cardID]?.[referenceType];

			if( currentValue != undefined && currentValue != value) {
				//This is a special case; the reference already exists, yes, but we're changing its value, and that's OK.
			} else {
				return 'The editing card already has a ' + baseType + ' reference (or subtype) to that card';
			}
		}

		if (referenceTypeConfig.toCardTypeAllowList) {
			if (!referenceTypeConfig.toCardTypeAllowList[toCardType]) {
				return 'That reference type may not point to cards of type ' + toCardType;
			}
		}

		if (referenceTypeConfig.fromCardTypeAllowList) {
			if ((this._cardObj as Card).card_type && !referenceTypeConfig.fromCardTypeAllowList[(this._cardObj as Card).card_type]) {
				return 'That reference type may not originate from cards of type ' + (this._cardObj as Card).card_type;
			}
		}

		return '';
	}

	mayNotApplyEntriesDiffReason(state : State, diff : ReferencesEntriesDiff) : string {
		const referencesCopy = references({...this._cardObj});
		let i = 0;
		for (const item of diff) {
			const reason = (referencesCopy as ReferencesAccessorFull)._mayNotApplyEntryDiffItemReason(state, item);
			if (reason) {
				return 'The ' + i + ' diff item could not be applied: ' + reason;
			}
			referencesCopy._applyEntryDiffItem(item);
			i++;
		}
		return '';
	}
}

// Export the extended class as ReferencesAccessor for backwards compatibility
export { ReferencesAccessorFull as ReferencesAccessor };

const memoizedCardAccessors = new WeakMap();

//Like references, but in a way that doesn't modify the card.
export const referencesNonModifying = (cardObj : CardLike) : ReferencesAccessorFull => {
	const cardCopy = {...cardObj};
	return references(cardCopy);
};

//References returns a ReferencesAccessor to access references for this cardObj.
export const references = (cardObj : CardLike | null) : ReferencesAccessorFull => {
	if (!cardObj) return new ReferencesAccessorFull({});
	let accessor = memoizedCardAccessors.get(cardObj);
	if (!accessor) {
		accessor = new ReferencesAccessorFull(cardObj);
		memoizedCardAccessors.set(cardObj, accessor);
	}
	return accessor;
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
			for (const [referenceType, value] of TypedObject.entries(cardReferences)) {
				refs.setCardReference(cardID, referenceType, value);
			}
		}
	}
	return fauxCard;
};

//Returns a card-like object with a reference block that is the INTERSECTION of the
//references of all cardObjs provided. See also unionReferences.
export const intersectionReferences = (cardObjs : Card[]) : CardLike => {
	const fauxCard : CardLike = {};
	const refs = references(fauxCard);
	const firstCard = cardObjs.length ? cardObjs[0] : null;
	refs.ensureReferences(firstCard);
	const fauxCardReferencesInfo = fauxCard.references_info || {};
	//skip the first card, which we basically copied, and remove everything else.
	for (const card of cardObjs.slice(1)){
		const referencesInfo = card[REFERENCES_INFO_CARD_PROPERTY];
		for (const [cardID, cardReferences] of TypedObject.entries(referencesInfo)) {
			for (const referenceType of TypedObject.keys(cardReferences)) {
				//Leave items that we have.
				if (fauxCardReferencesInfo[cardID] && fauxCardReferencesInfo[cardID][referenceType] !== undefined) continue;
				refs.removeCardReference(cardID, referenceType);
			}
		}
		//Now remove any items from first that the others don't have
		for (const [cardID, cardReferences] of TypedObject.entries(fauxCardReferencesInfo)) {
			for (const referenceType of TypedObject.keys(cardReferences)) {
				//Leave items that we have.
				if (referencesInfo[cardID] && referencesInfo[cardID][referenceType] !== undefined) continue;
				refs.removeCardReference(cardID, referenceType);
			}
		}
	}
	return fauxCard;
};

// Wrappers that pass the client SDK's deleteField sentinel

export const applyReferencesDiff = (beforeCard : Card, afterCard : Card, update : CardUpdate) => {
	return sharedApplyReferencesDiff(beforeCard, afterCard, update, deleteField());
};

// Functions only used in src/ context (not extracted to shared)

const referencesEntriesDiffWithoutItem = (diff : ReferencesEntriesDiff = [], cardID : CardID, referenceType : ReferenceType, isDelete : boolean) : ReferencesEntriesDiff => {
	return diff.filter(item => {
		if (item.cardID != cardID) return false;
		if (item.referenceType != referenceType) return false;
		if (isExpandedReferenceDelete(item) != isDelete) return false;
		return true;
	});
};

export const referencesEntriesDiffWithSet = (diff : ReferencesEntriesDiff = [], cardID : CardID, referenceType : ReferenceType, value  = '') : ReferencesEntriesDiff => {
	const trimmedDiff = referencesEntriesDiffWithoutItem(diff, cardID, referenceType, true);
	if (trimmedDiff.length < diff.length) return trimmedDiff;
	return [...diff, {cardID, referenceType, value}];
};

export const referencesEntriesDiffWithRemove = (diff : ReferencesEntriesDiff = [], cardID : CardID, referenceType : ReferenceType) : ReferencesEntriesDiff => {
	const trimmedDiff = referencesEntriesDiffWithoutItem(diff, cardID, referenceType, false);
	if (trimmedDiff.length < diff.length) return trimmedDiff;
	return [{cardID, referenceType, delete: true as const}, ...diff];
};
