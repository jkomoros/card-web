const common = require('./common.js');
const db = common.db;
const FieldValue = common.FieldValue;

const REFERENCES_INFO_CARD_PROPERTY = common.REFERENCES_INFO_CARD_PROPERTY;
const REFERENCES_CARD_PROPERTY = common.REFERENCES_CARD_PROPERTY;

//MOSTLY duplicated from src/card_fields.js;
const referencesLegal = (cardObj) => {
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
		for (let value of Object.values(cardBlock)) {
			//The only types of keys that are allowed are the explicitly defined reference types
			//We don't have the constant here so just skip
			//if (!REFERENCE_TYPES[key]) return false;
			if (typeof value !== 'string') return false;
		}
		let referenceValue = referencesBlock[cardID];
		if (typeof referenceValue !== 'boolean') return false;
		//only true is allowed, since it shows that an object exists at that key in references_info
		if (!referenceValue) return false;
	}
	return true;
};

//Duplciated from card_fields.js
const cardReferenceBlockHasDifference = (before, after) => {
	for(let linkType of Object.keys(before)) {
		if (after[linkType] === undefined) return true;
		if (after[linkType] !== before[linkType]) return true;
	}
	for (let linkType of Object.keys(after)) {
		if (before[linkType] === undefined) return true;
	}
	return false;
}

//Duplicated from src/card_fields.js
const referencesCardsDiff = (beforeCard, afterCard) => {
	const result = [{}, {}];
	const emptyCard = {[REFERENCES_INFO_CARD_PROPERTY]:{}, [REFERENCES_CARD_PROPERTY]: {}};
	if (!beforeCard || Object.keys(beforeCard).length === 0) beforeCard = emptyCard;
	if (!afterCard || Object.keys(afterCard).length === 0) afterCard = emptyCard;
	if (!referencesLegal(beforeCard)) return result;
	if (!referencesLegal(afterCard)) return result;
	const before = beforeCard[REFERENCES_INFO_CARD_PROPERTY];
	const after = afterCard[REFERENCES_INFO_CARD_PROPERTY];
	//For card blocks that exist in both before and after... but might have modifications within them
	let cardSame = {};
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

const inboundLinks = (change, context) => {

	//We are registered onWrite, instead of onUpdate, since forked cards might
	//start out with references to modify when they are created.

	if (common.DISABLE_CARD_UPDATE_FUNCTIONS) return Promise.resolve();

	//Skip deletions
	if (!change.after.exists) return Promise.resolve();

	const beforeCard = change.before.exists ? change.before.data() : null;
	const afterCard = change.after.data();

	const [changes, deletions] = referencesCardsDiff(beforeCard, afterCard);

	if (Object.keys(changes).length === 0 && Object.keys(deletions).length === 0) return Promise.resolve();

	const afterReferencesInfo = afterCard[common.REFERENCES_INFO_CARD_PROPERTY];
	const afterReferences = afterCard[common.REFERENCES_CARD_PROPERTY];

	let cardID = context.params.cardId;

	let batch = db.batch();

	for (let otherCardID of Object.keys(changes)) {
		let ref = db.collection('cards').doc(otherCardID);
		let update = {
			[common.REFERENCES_INFO_INBOUND_CARD_PROPERTY + '.' + cardID]: afterReferencesInfo[otherCardID],
			[common.REFERENCES_INBOUND_CARD_PROPERTY + '.' + cardID]: afterReferences[otherCardID],
		};
		batch.update(ref, update);
	}

	for (let otherCardID of Object.keys(deletions)) {
		let ref = db.collection('cards').doc(otherCardID);
		let update = {
			[common.REFERENCES_INFO_INBOUND_CARD_PROPERTY + '.' + cardID]: FieldValue.delete(),
			[common.REFERENCES_INBOUND_CARD_PROPERTY + '.' + cardID]: FieldValue.delete(),
		};
		batch.update(ref, update);
	}

	return batch.commit();

}

const TYPE_MAINTENANCE_MODE = 'maintenance_mode';

//data is expected to have a type
const status = (data) => {
	const typ = data.type || TYPE_MAINTENANCE_MODE;
	if (typ === TYPE_MAINTENANCE_MODE) {
		//NOTE: the correctness of this assumes you also deployed the
		//updateInboundLinks recently after the config was changed. The gulp
		//task does that, but it's technically possible to be out of sync.
		return common.DISABLE_CARD_UPDATE_FUNCTIONS;
	}
	return false;
};

exports.inboundLinks = inboundLinks;
exports.status = status;