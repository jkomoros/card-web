const common = require('./common.js');
const db = common.db;
const FieldValue = common.FieldValue;

const arrayDiff = (before, after) => {
    let afterMap = new Map();
    for (let item of after) {
        afterMap.set(item, true);
    }
    let deletions = [];
    for (let item of before) {
        if (afterMap.has(item)) {
            //Keep track of that we've seen this one
            afterMap.delete(item);
        } else {
            deletions.push(item);
        }
    }
    //Additions is the keys not remved in afterMap
    let additions = [...afterMap.keys()];
    return [additions, deletions];
};

const inboundLinks = (change, context) => {

    let [additions, deletions] = arrayDiff(change.before.data().links, change.after.data().links);

    if (additions.length === 0 && deletions.length === 0) return Promise.resolve();

    let cardId = context.params.cardId;

    let batch = db.batch();

    for (let card of additions) {
        let ref = db.collection('cards').doc(card);
        batch.update(ref, {
            links_inbound: FieldValue.arrayUnion(cardId)
        });
    }

    for (let card of deletions) {
        let ref = db.collection('cards').doc(card);
        batch.update(ref, {
            links_inbound: FieldValue.arrayRemove(cardId)
        });
    }

    return batch.commit();


}

exports.inboundLinks = inboundLinks;