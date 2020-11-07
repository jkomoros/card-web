const common = require('./common.js');
const db = common.db;
const FieldValue = common.FieldValue;

//MOSTLY duplicated from src/card_fields.js;
const referencesLegal = (referencesBlock) => {
	if (!referencesBlock) return false;
	if (typeof referencesBlock !== 'object') return false;
	if (Array.isArray(referencesBlock)) return false;
	//It's OK for it to have no keys.
	if (Object.keys(referencesBlock).length === 0) return true;
	for (let cardBlock of Object.values(referencesBlock)) {
		if (!cardBlock) return false;
		if (typeof cardBlock !== 'object') return false;
		if (Array.isArray(referencesBlock)) return false;
		//If a card block is empty is shouldn't exist
		if (Object.keys(cardBlock).length === 0) return false;
		for (let value of Object.values(cardBlock)) {
			//The only types of keys that are allowed are the explicitly defined reference types
			//We don't have the following constant here, so just skip
			//if (!LEGAL_REFERENCE_TYPES[key]) return false;
			if (typeof value !== 'string') return false;
		}
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
const referencesCardsDiff = (before, after) => {
	const result = [{}, {}];
	if (!referencesLegal(before)) return result;
	if (!referencesLegal(after)) return result;
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

	if (common.DISABLE_CARD_UPDATE_FUNCTIONS) return Promise.resolve();

	const beforeReferences = change.before.data()[common.REFERENCES_INFO_CARD_PROPERTY];
	const afterReferences = change.after.data()[common.REFERENCES_INFO_CARD_PROPERTY];
	const afterReferencesSentinel = change.after.data()[common.REFERENCES_CARD_PROPERTY];

	const [changes, deletions] = referencesCardsDiff(beforeReferences, afterReferences);

	if (Object.keys(changes).length === 0 && Object.keys(deletions).length === 0) return Promise.resolve();

	let cardID = context.params.cardId;

	let batch = db.batch();

	for (let otherCardID of Object.keys(changes)) {
		let ref = db.collection('cards').doc(otherCardID);
		let update = {
			[common.REFERENCES_INFO_INBOUND_CARD_PROPERTY + '.' + cardID]: afterReferences[otherCardID],
			[common.REFERENCES_INBOUND_CARD_PROPERTY + '.' + cardID]: afterReferencesSentinel[otherCardID],
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