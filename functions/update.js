const common = require('./common.js');
const db = common.db;
const FieldValue = common.FieldValue;
const fromEntries = require('fromentries');

const arrayDiff = (before, after) => {
    let afterMap = new Map();
    for (let item of after) {
        afterMap.set(item, true);
    }
    let deletions = [];
    let same = [];
    for (let item of before) {
        if (afterMap.has(item)) {
            //Keep track of that we've seen this one
            afterMap.delete(item);
            same.push(item);
        } else {
            deletions.push(item);
        }
    }
    //Additions is the keys not remved in afterMap
    let additions = [...afterMap.keys()];
    return [additions, deletions, same];
};

//Returns an objectof key names: true where its value in before and its value in
//after are different (either because they both have the key and the value
//changed, or because a key is one but not the other.
const updatedKeys = (before, after) => {
    if (!before && !after) return {};
    if (!before) return fromEntries(Object.keys(after).map(item => [item, true]));
    if (!after) return fromEntries(Object.keys(before).map(item => [item, true]));

    let keys = new Map();
    for (let key of Object.keys(before)) {
        keys.set(key, true);
    }
    for (let key of Object.keys(after)) {
        keys.set(key, true);
    }

    let result = {};
    for (let key of keys.keys()) {
        if (before[key] === after[key]) continue;
        result[key] = true;
    }

    return result;

}

const inboundLinks = (change, context) => {

    if (common.DISABLE_CARD_UPDATE_FUNCTIONS) return Promise.resolve();

    let [additions, deletions, same] = arrayDiff(change.before.data().links, change.after.data().links);

    let linkTextMap = change.after.data().links_text || {};
    let beforeLinkTextMap = change.before.data().links_text || {};

    let textChangedCards = updatedKeys(beforeLinkTextMap, linkTextMap);

    let updatedText = same.map(id => textChangedCards[id] ? id : '').filter(item => item);

    if (additions.length === 0 && deletions.length === 0 && updatedText.length === 0) return Promise.resolve();

    let cardId = context.params.cardId;

    let batch = db.batch();

    for (let card of additions) {
        let ref = db.collection('cards').doc(card);
        let update = {
            links_inbound: FieldValue.arrayUnion(cardId),
        };
        update['links_inbound_text.' + cardId] = linkTextMap[card];
        batch.update(ref, update);
    }

    //Now the cards that were neither added or deleted but did update the text.
    for (let card of updatedText) {
        let ref = db.collection('cards').doc(card);
        let update = {};
        update['links_inbound_text.' + cardId] = linkTextMap[card];
        batch.update(ref, update);
    }

    for (let card of deletions) {
        let ref = db.collection('cards').doc(card);
        let update = {
            links_inbound: FieldValue.arrayRemove(cardId)
        };
        update['links_inbound_text.' + cardId] = FieldValue.delete();
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