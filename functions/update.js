const common = require('./common.js');
const db = common.db;
const FieldValue = common.FieldValue;
const fromEntries = require('fromentries');

const ngraph = require('ngraph.graph');
const pagerank = require('ngraph.pagerank');
const MultiBatch = require('./multi_batch.js');

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

const inboundLinks = async (change, context) => {

    let [additions, deletions, same] = arrayDiff(change.before.data().links, change.after.data().links);

    let linkTextMap = change.after.data().links_text || {};
    let beforeLinkTextMap = change.before.data().links_text || {};

    let textChangedCards = updatedKeys(beforeLinkTextMap, linkTextMap);

    let updatedText = same.map(id => textChangedCards[id] ? id : '').filter(item => item);

    if (additions.length === 0 && deletions.length === 0 && updatedText.length === 0) return;

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

    await batch.commit();

    if (additions.length > 0 || deletions.length > 0) {
        await calculatePageRank();
    }

    return;
}

const calculatePageRank = async () => {
    //This function normally takes less than a second to run. By far the largest
    //part of runtime is updating the cards with the new values.

    const graph = ngraph();
    const cards = await db.collection('cards').get();
    for (let cardSnapshot of cards.docs) {
        const id = cardSnapshot.id;
        const links = cardSnapshot.data().links;
        for (let link of links) {
            graph.addLink(id, link);
        }
    }

    const ranks = pagerank(graph);

    let skippedCards = 0;

    const batch = new MultiBatch(db);
    for (let cardSnapshot of cards.docs) {
        const id = cardSnapshot.id;
        const rank = ranks[id] || 0.0;
        if (cardSnapshot.data().card_rank === rank) {
            skippedCards++
            continue;
        }
        batch.update(cardSnapshot.ref, {card_rank: rank});
    }

    console.log("Skipped updating " + skippedCards + " of " + cards.docs.length + " cards that didn't have changed pagerank");
    await batch.commit();
    return;

};

exports.inboundLinks = inboundLinks;