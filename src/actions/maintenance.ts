export const UPDATE_EXECUTED_MAINTENANCE_TASKS = 'UPDATE_EXECUTED_MAINTENANCE_TASKS';
export const UPDATE_MAINTENANCE_TASK_ACTIVE = 'UPDATE_MAINTENANCE_TASK_ACTIVE';

import {
	CARDS_COLLECTION,
	SECTIONS_COLLECTION,
	MAINTENANCE_COLLECTION,
	TWEETS_COLLECTION,
} from './database.js';

import {
	AppThunkDispatch,
	AppGetState,
	store,
	AppActionCreator
} from '../store.js';

import {
	db
} from '../firebase.js';

import {
	normalizeBodyHTML
} from '../contenteditable.js';

import { 
	newID,
} from '../util.js';

import {
	MultiBatch,
} from '../multi_batch.js';

import {
	selectUser,
	selectCards,
	selectDefaultSet,
	selectEverythingSet
} from '../selectors.js';

import {
	defaultCardObject,
	modifyCardWithBatch
} from './data.js';

import {
	generateCardDiff
} from '../card_diff.js';

import {
	CARD_TYPE_EDITING_FINISHERS
} from '../card_finishers.js';

import {
	ensureAuthor,
} from './comments.js';

import {
	READING_LIST_FALLBACK_CARD,
	STARS_FALLBACK_CARD,
} from '../tabs.js';

import {
	fontSizeBoosts,
	MAX_SORT_ORDER_VALUE,
	MIN_SORT_ORDER_VALUE,
	DEFAULT_SORT_ORDER_INCREMENT
} from '../card_fields.js';

import {
	CARD_TYPE_CONTENT,
	CARD_TYPE_SECTION_HEAD,
	REFERENCES_INFO_CARD_PROPERTY,
	REFERENCES_CARD_PROPERTY,
	REFERENCES_INFO_INBOUND_CARD_PROPERTY,
	REFERENCES_INBOUND_CARD_PROPERTY
} from '../card_field_constants.js';

import {
	onSnapshot,
	collection,
	getDocs,
	query,
	where,
	doc,
	setDoc,
	getDoc,
	serverTimestamp,
	updateDoc,
	DocumentSnapshot
} from 'firebase/firestore';

import { cardDiffHasChanges } from '../card_diff.js';

import {
	Card,
	CardID,
	SectionUpdate,
	MaintenanceTaskMap,
	MaintenanceTaskID,
	MaintenanceTask,
	ImageBlock
} from '../types.js';

import {
	AnyAction
} from 'redux';

import {
	TypedObject
} from '../typed_object.js';

export const connectLiveExecutedMaintenanceTasks = () => {
	onSnapshot(collection(db, MAINTENANCE_COLLECTION), snapshot => {

		let tasks : MaintenanceTaskMap = {};

		snapshot.docChanges().forEach(change => {
			if (change.type === 'removed') return;
			let doc = change.doc;
			let id = doc.id;
			let task = {...doc.data({serverTimestamps: 'estimate'}), id} as MaintenanceTask;
			tasks[id] = task;
		});

		store.dispatch(updateExecutedMaintenanceTasks(tasks));

	});
};

const updateExecutedMaintenanceTasks = (executedTasks : MaintenanceTaskMap) : AnyAction => {
	return {
		type: UPDATE_EXECUTED_MAINTENANCE_TASKS,
		executedTasks,
	};
};

const NORMALIZE_CONTENT_BODY = 'normalize-content-body-again';

const normalizeContentBody : MaintenanceTaskFunction = async() => {
	let snapshot = await getDocs(collection(db, CARDS_COLLECTION));

	let counter = 0;
	let size = snapshot.size;

	for (let doc of snapshot.docs) {
		counter++;
		let body = doc.data().body;
		if (body) {
			await updateDoc(doc.ref,{
				body: normalizeBodyHTML(body),
				updated_normalize_body: serverTimestamp(),
			});
		}
		console.log('Processed ' + doc.id + ' (' + counter + '/' + size + ')' );
	}
};

const UPDATE_INBOUND_LINKS = 'update-inbound-links';

const updateInboundLinks : MaintenanceTaskFunction = async() => {

	//This task is designed to run as often as you want, so we don't check if we've run it and mark as run.

	let snapshot = await getDocs(collection(db,CARDS_COLLECTION));

	let counter = 0;
	let size = snapshot.size;

	let batch = new MultiBatch(db);

	for (let doc of snapshot.docs) {
		counter++;
		let linkingCardsSnapshot = await getDocs(query(collection(db, CARDS_COLLECTION), where(REFERENCES_CARD_PROPERTY + '.' + doc.id, '==', true)));
		if(!linkingCardsSnapshot.empty) {
			let referencesInbound : {[name : string] : any} = {};
			let referencesInboundSentinel: {[name : string] : any} = {};
			linkingCardsSnapshot.forEach((linkingCard : DocumentSnapshot) => {
				referencesInbound[linkingCard.id] = linkingCard.data()[REFERENCES_INFO_CARD_PROPERTY][doc.id];
				referencesInboundSentinel[linkingCard.id] = linkingCard.data()[REFERENCES_CARD_PROPERTY][doc.id];
			});
			batch.update(doc.ref, {
				updated_references_inbound: serverTimestamp(),
				[REFERENCES_INFO_INBOUND_CARD_PROPERTY]: referencesInbound,
				[REFERENCES_INBOUND_CARD_PROPERTY]: referencesInboundSentinel,
			});
		}
		console.log('Processed ' + doc.id + ' (' + counter + '/' + size + ')' );
	}

	await batch.commit();

};

const RESET_TWEETS = 'reset-tweets';

const resetTweets : MaintenanceTaskFunction = async() => {
	//Mark all tweets as having not been run
	if (!confirm('Are you SURE you want to reset all tweets?')) return;
	let batch = new MultiBatch(db);
	let snapshot = await getDocs(collection(db,CARDS_COLLECTION));
	snapshot.forEach(doc => {
		batch.update(doc.ref, {'tweet_count': 0, 'last_tweeted': new Date(0)});
	});
	let tweetSnapshot = await getDocs(collection(db, TWEETS_COLLECTION));
	tweetSnapshot.forEach(doc => {
		batch.update(doc.ref, {'archived': true, 'archive_date': serverTimestamp()});
	});
	await batch.commit();
};

const INITIAL_SET_UP = 'initial-set-up';

const initialSetup : MaintenanceTaskFunction = async (_, getState) => {

	const user = selectUser(getState());

	const starterSections : {[sectionName : string] : SectionUpdate} = {
		main: {
			title: 'Main',
			subtitle: 'The main collection of cards',
		},
	};

	let batch = new MultiBatch(db);

	const sectionsCollection = collection(db, SECTIONS_COLLECTION);
	const cardsCollection = collection(db, CARDS_COLLECTION);

	let count = 0;
	let sortOrder = (MAX_SORT_ORDER_VALUE - MIN_SORT_ORDER_VALUE) / 2;
	for (let [key, val] of Object.entries(starterSections)) {
		const update = {...val};
		const startCardId = 'section-' + key;
		const contentCardId = newID();
		update.updated = serverTimestamp();
		update.cards = [contentCardId];
		update.order = count;
		update.start_cards = [startCardId];
		batch.set(doc(sectionsCollection, key), update);

		//Put the first card smack in the middle.
		let sectionHeadCard = defaultCardObject(startCardId,user,key,CARD_TYPE_SECTION_HEAD, sortOrder);
		//get sortOreder ready for next user
		sortOrder -= DEFAULT_SORT_ORDER_INCREMENT;

		sectionHeadCard.title = update.title;
		sectionHeadCard.subtitle = update.subtitle;
		sectionHeadCard.published = true;
		batch.set(doc(cardsCollection, startCardId), sectionHeadCard);

		const contentCard = defaultCardObject(contentCardId, user, key, CARD_TYPE_CONTENT, sortOrder);
		//get sortOreder ready for next user
		sortOrder -= DEFAULT_SORT_ORDER_INCREMENT;
		contentCard.published = true;
		batch.set(doc(cardsCollection, contentCardId), contentCard);

		count++;
	}

	const readingListFallbackCard = defaultCardObject(READING_LIST_FALLBACK_CARD, user, '', CARD_TYPE_CONTENT, sortOrder);
	//get sortOreder ready for next user
	sortOrder -= DEFAULT_SORT_ORDER_INCREMENT;
	readingListFallbackCard.title = 'About Reading Lists';
	readingListFallbackCard.body = '<p>There are a lot of cards to read in the collection, and it can be hard to keep track.</p><p>You can use a feature called <strong>reading list</strong>&nbsp;to keep track of cards you want to read next. Just hit the reading-list button below any card (it\'s the button that looks like an icon to add to a playlist) and they\'ll show up in the Reading List tab. Once you\'re done reading that card, you can simply tap the button again to remove it from your reading list.</p><p>When you see a link on any card, you can also Ctrl/Cmd-Click it to automatically add it to your reading-list even without opening it. Links to cards that are already on your reading-list will show a double-underline.</p>' ;
	readingListFallbackCard.published = true;
	const starsFallbackCard = defaultCardObject(STARS_FALLBACK_CARD, user, '', CARD_TYPE_CONTENT, sortOrder);
	//get sortOreder ready for next user
	sortOrder -= DEFAULT_SORT_ORDER_INCREMENT;
	starsFallbackCard.title = 'About Stars';
	starsFallbackCard.body = '<p>You can star cards, and when you do they\'ll show up in the Starred list at the top nav.</p>';
	starsFallbackCard.published = true;

	batch.set(doc(cardsCollection, READING_LIST_FALLBACK_CARD), readingListFallbackCard);
	batch.set(doc(cardsCollection, STARS_FALLBACK_CARD), starsFallbackCard);

	ensureAuthor(batch, user);

	await batch.commit();

};

const ADD_FONT_SIZE_BOOST = 'add-font-size-boost';

const addFontSizeBoost : MaintenanceTaskFunction = async () => {

	let batch = new MultiBatch(db);
	let snapshot = await getDocs(collection(db, CARDS_COLLECTION));
	snapshot.forEach(doc => {
		batch.update(doc.ref, {font_size_boost: {}});
	});

	await batch.commit();
};

const UPDATE_FONT_SIZE_BOOST = 'update-font-size-boost';

const updateFontSizeBoost : MaintenanceTaskFunction = async () => {

	let batch = new MultiBatch(db);
	let snapshot = await getDocs(collection(db, CARDS_COLLECTION));
	let counter = 0;
	//if this were forEach then the async gets weird as multiple queue up.
	for (let doc of snapshot.docs) {
		console.log('Processing ' + counter + '/' + snapshot.size);
		counter++;
		const card : Card = {...doc.data() as Card, id : doc.id as CardID};

		const beforeBoosts = card.font_size_boost;
		//NOTE: maintence-view includes a hidden card-stage so this will have a card renderer to use
		const afterBoosts = await fontSizeBoosts(card);

		if (Object.keys(beforeBoosts).length == Object.keys(afterBoosts).length && TypedObject.entries(beforeBoosts).every(entry => entry[1] == afterBoosts[entry[0]])) continue;

		console.log('Card ' + doc.id + ' had an updated boost');
		batch.update(doc.ref, {font_size_boost: afterBoosts});
	}

	await batch.commit();

};

const CONVERT_MULTI_LINKS_DELIMITER = 'convert-multi-links-delimiter';

const convertMultiLinksDelimiter : MaintenanceTaskFunction = async () => {
	const OLD_MULTI_LINK_DELIMITER = ' || ';

	let batch = new MultiBatch(db);
	let snapshot = await getDocs(collection(db, CARDS_COLLECTION));
	snapshot.forEach(doc => {
		let card = doc.data();
		let update = {};

		let referencesInfo = card[REFERENCES_INFO_CARD_PROPERTY];
		for (let [otherCardID, referenceMap] of Object.entries(referencesInfo)) {
			for (let [referenceType, value] of Object.entries(referenceMap)) {
				if (value.includes(OLD_MULTI_LINK_DELIMITER)) {
					value = value.split(OLD_MULTI_LINK_DELIMITER).join('\n');
					update[REFERENCES_INFO_CARD_PROPERTY + '.' + otherCardID + '.' + referenceType] = value;
				}
			}
		}

		if (Object.keys(update).length == 0) return;
		console.log('Updating doc: ', doc.id, update);
		batch.update(doc.ref, update);
	});

	await batch.commit();
};

const FLIP_AUTO_TODO_OVERRIDES = 'flip-auto-todo-overrides';

const flipAutoTodoOverrides : MaintenanceTaskFunction = async () => {
	let batch = new MultiBatch(db);
	let snapshot = await getDocs(collection(db, CARDS_COLLECTION));
	snapshot.forEach(doc => {
		let card = doc.data();

		const originalOverrides = card.auto_todo_overrides || {};

		if (Object.keys(originalOverrides).length == 0) return;

		const flippedOverrides = Object.fromEntries(Object.entries(originalOverrides).map(entry => [entry[0], !entry[1]]));
		const update = {
			auto_todo_overrides: flippedOverrides,
		};

		console.log('Updating doc: ', doc.id, update);
		batch.update(doc.ref, update);
	});

	await batch.commit();
};

const SET_MAINTENANCE_TASK_VERSION = 'set-maintenance-task-version';

const setMaintenanceTaskVersion : MaintenanceTaskFunction = async () => {
	let batch = new MultiBatch(db);

	let seenTasks : {[id : MaintenanceTaskID] : true} = {};

	let snapshot = await getDocs(collection(db, MAINTENANCE_COLLECTION));
	snapshot.forEach(doc => {
		let taskName = doc.id as MaintenanceTaskID;
		seenTasks[taskName] = true;
		let data = doc.data();
		if (data.version !== undefined) return;
		batch.update(doc.ref, {version: MAINTENANCE_TASK_VERSION});
	});

	//Create entries for any items that haven't yet been run
	for (const taskName of Object.keys(MAINTENANCE_TASKS)) {
		if (seenTasks[taskName]) continue;
		const ref = doc(db, MAINTENANCE_COLLECTION, taskName);
		batch.set(ref, {timestamp: serverTimestamp(), version: MAINTENANCE_TASK_VERSION, createdBy:SET_MAINTENANCE_TASK_VERSION});
	}

	await batch.commit();
};

const ADD_IMAGES_PROPERTY = 'add-images-property';

const addImagesProperty : MaintenanceTaskFunction = async () => {
	let batch = new MultiBatch(db);
	let snapshot = await getDocs(collection(db, CARDS_COLLECTION));
	snapshot.forEach(doc => {
		const update = {
			images: [] as ImageBlock,
		};
		batch.update(doc.ref, update);
	});

	await batch.commit();
};

const RERUN_CARD_FINISHERS = 'rerun-card-finishers';

const rerunCardFinishers : MaintenanceTaskFunction = async (_, getState) => {

	let batch = new MultiBatch(db);

	const state = getState();
	const cards = selectCards(state);
	for (const underlyingCard of Object.values(cards)) {
		const finisher = CARD_TYPE_EDITING_FINISHERS[underlyingCard.card_type];
		if (!finisher) continue;
		const updatedCard = {...underlyingCard};
		finisher(updatedCard, state);
		const diff = generateCardDiff(underlyingCard, updatedCard);
		if (!cardDiffHasChanges(diff)) continue;
		console.log('Updating card ' + underlyingCard.id + '\n', underlyingCard.title, '\n', updatedCard.title);
		try {
			modifyCardWithBatch(state, underlyingCard, diff, false, batch);
		} catch (err) {
			console.warn('Card ' + underlyingCard.id + ' had error: ' + err);
		}
	}
	await batch.commit();
};

const ADD_SORT_ORDER_PROPERTY = 'add-sort-order-property';

const addSortOrderProperty : MaintenanceTaskFunction = async (_, getState) => {

	let batch = new MultiBatch(db);

	const state = getState();
	const cards = selectCards(state);

	if (Object.values(cards).some(card => card.sort_order)) {
		throw new Error('At least some cards appeared to already have sort_order property');
	}


	//Note: this logic assume that the cards don't already have sort_order and
	//htat defaultSet is being built in the legacy, via sections, way. 
	
	//IDs, not full cards.
	const defaultSet = selectDefaultSet(state);
	const everythingSet = [...selectEverythingSet(state)];
	//We want newer things with higher numbers by default, but evertyhing set by default is recently updated things first
	everythingSet.reverse();
	//This will have all IDs in the proper order, but with every default item
	//also showing up later in everything set.
	const fullDupedSet = [...defaultSet, ...everythingSet];
	//Use set to remove duplicates in order
	const fullOrderedSet = [... new Set(fullDupedSet)];

	let counter = MAX_SORT_ORDER_VALUE;
	const increment = (MAX_SORT_ORDER_VALUE - MIN_SORT_ORDER_VALUE) / Object.keys(cards).length;

	for (const cardID of fullOrderedSet) {
		const card = cards[cardID];
		if (!card) throw new Error(cardID + ' was not found in cards collection');
		const ref = doc(db, CARDS_COLLECTION, cardID);
		batch.update(ref, {sort_order: counter});
		counter -= increment;
	}

	await batch.commit();
};

//The value of MAINTENANCE_TASK_VERSION when this instance of the app was set up
const setUpVersion = (executedTasks : MaintenanceTaskMap) => {
	const setUpTaskRecord = executedTasks[INITIAL_SET_UP];
	if (!setUpTaskRecord) return -1;
	return setUpTaskRecord.version;
};

const lastExecutedMaintenanceTask = (executedTasks : MaintenanceTaskMap) => {
	let min = '';
	let timestamp = 0;
	for (const [taskName, taskDetails] of Object.entries(executedTasks)) {
		if (taskDetails.timestamp.seconds < timestamp) continue;
		min = taskName;
		timestamp = taskDetails.timestamp.seconds;
	}
	return min;
};

//Returns the name of the next maintenance task to run, or '' if there aren't any.
export const nextMaintenanceTaskName = (executedTasks : MaintenanceTaskMap) => {
	const initialVersion = setUpVersion(executedTasks);
	const lastTask = lastExecutedMaintenanceTask(executedTasks);
	if (lastTask && MAINTENANCE_TASKS[lastTask] && MAINTENANCE_TASKS[lastTask].nextTaskName) {
		const nextTask = MAINTENANCE_TASKS[lastTask].nextTaskName;
		//If the next task was never run, suggest it
		if (!executedTasks[nextTask]) return nextTask;
		//If the next task was run, but BEFORE the last task, suggest it.
		if (executedTasks[nextTask].timestamp.seconds < executedTasks[lastTask].timestamp.seconds) return nextTask;
	}
	//Iterating in order of maintenance tasks.
	for (const [taskName, taskConfig] of Object.entries(MAINTENANCE_TASKS)) {
		if (executedTasks[taskName]) continue;
		if (taskConfig.recurring) continue;
		//These are tasks that were added BEFORE this instance was set up, so
		//they never need to be run on this instance.
		if (initialVersion >= taskConfig.minVersion) continue;
		return taskName;
	}
	return '';
};

const makeMaintenanceActionCreator = (taskName : MaintenanceTaskID, taskConfig : RawMaintenanceTaskDefinition) : AppActionCreator => {
	const fn = taskConfig.fn;
	return () => async (dispatch, getState) => {
		let ref = doc(db, MAINTENANCE_COLLECTION, taskName);

		if (!taskConfig.recurring) {
			let doc = await getDoc(ref);
		
			if (doc.exists()) {
				if (!window.confirm('This task has been run before on this database. Do you want to run it again?')) {
					throw taskName + ' has been run before and the user didn\'t want to run again';
				}
			}
		}

		dispatch({
			type: UPDATE_MAINTENANCE_TASK_ACTIVE,
			active: true,
		});
	
		try {
			await fn(dispatch, getState);
		} catch(err) {
			alert('Error: ' + err + '\nOpen the console, copy the contents, and create a new issue on github.com/jkomoros/card-web');
			//Also put it in the console so they can copy and paste
			console.warn('Error: ' + err);
			dispatch({
				type: UPDATE_MAINTENANCE_TASK_ACTIVE,
				active: false,
			});
			return;
		}

		await setDoc(doc(db, MAINTENANCE_COLLECTION, taskName), {
			timestamp: serverTimestamp(),
			version: MAINTENANCE_TASK_VERSION,
		});
		console.log('done');

		dispatch({
			type: UPDATE_MAINTENANCE_TASK_ACTIVE,
			active: false,
		});

		return;
	};
};

//This integer should monotonically increase every time a new item is added
//RAW_TASKS that is not recurring. It is how we detect if a maintenance task is
//eligible for this instance of an app, since maintenance tasks that were
//implemented BEFORE this instance had its initial set up called don't need
//them, because we assume that if you were to set up a new instance at any given
//moment, the non-recurring maintenance tasks are already implicitly run and
//included in normal operation of the webapp as soon as they were added.
const MAINTENANCE_TASK_VERSION = 3;

type MaintenanceTaskFunction = (dispatch: AppThunkDispatch, getState: AppGetState) => void

interface RawMaintenanceTaskDefinition {
	//the raw function that does the thing. It will be passed dispatch, getState.
	fn : MaintenanceTaskFunction,
	//string to show in UI
	displayName? : string,
	//The raw value of the MAINTENANCE_TASK_VERSION when this task was added to the list. SEE BELOW.
	minVersion: number,
	// if true, then the task can be run multiple times.
	recurring? : boolean,
	//If set, the string name of the task the user should run next.
	nextTaskName? : MaintenanceTaskID
}

interface MaintenanceTaskDefinition extends RawMaintenanceTaskDefinition {
	actionCreator: AppActionCreator,
}

/*
When adding new tasks, increment MAINTENANCE_TASK_VERSION by one. Set the new
task's minVersion to the new raw value of MAINTENANCE_TASK_VERSION. Append the
new task to the END of the raw_tasks list.
*/
const RAW_TASKS : {[id : MaintenanceTaskID]: RawMaintenanceTaskDefinition} = {
	[INITIAL_SET_UP]: {
		fn: initialSetup,
		displayName: 'Initial Set Up',
		minVersion: 0,
	},
	[NORMALIZE_CONTENT_BODY]: {
		fn: normalizeContentBody,
		minVersion: 0,
	},
	[RESET_TWEETS]: {
		fn: resetTweets,
		minVersion: 0,
		recurring: true,
	},
	[ADD_FONT_SIZE_BOOST]: {
		fn: addFontSizeBoost,
		minVersion: 0,
	},
	[UPDATE_FONT_SIZE_BOOST]: {
		fn: updateFontSizeBoost,
		minVersion: 0,
		recurring: true,
	},
	[CONVERT_MULTI_LINKS_DELIMITER]: {
		fn: convertMultiLinksDelimiter,
		minVersion: 0,
	},
	[FLIP_AUTO_TODO_OVERRIDES]: {
		fn: flipAutoTodoOverrides,
		minVersion: 0,
	},
	[UPDATE_INBOUND_LINKS]: {
		fn: updateInboundLinks,
		minVersion: 0,
		recurring: true,
	},
	[SET_MAINTENANCE_TASK_VERSION]: {
		fn: setMaintenanceTaskVersion,
		minVersion: 1,
	},
	[ADD_IMAGES_PROPERTY]: {
		fn: addImagesProperty,
		minVersion: 2,
	},
	[RERUN_CARD_FINISHERS]: {
		fn: rerunCardFinishers,
		recurring: true,
		minVersion: 0,
	},
	[ADD_SORT_ORDER_PROPERTY]: {
		fn: addSortOrderProperty,
		minVersion: 3,
	},
};

//It's so important that RAW_TASKS minVersion is set correctly that we'll catch obvious mistakes here.
Object.entries(RAW_TASKS).forEach(entry => {
	if (entry[1].minVersion === undefined || entry[1].minVersion > MAINTENANCE_TASK_VERSION) {
		throw new Error(entry[0] + ' was missing minVersion');
	}
});

export const MAINTENANCE_TASKS : {[id : MaintenanceTaskID] : MaintenanceTaskDefinition} = Object.fromEntries(TypedObject.entries(RAW_TASKS).map(entry => [entry[0], {...entry[1], actionCreator: makeMaintenanceActionCreator(entry[0], entry[1])}]));