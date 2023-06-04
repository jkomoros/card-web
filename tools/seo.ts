import * as fs from 'fs';
import * as path from 'path';
import * as process from 'process';
import striptags from 'striptags';

import {
	Config
} from './types.js';

import {
	FirebaseOptions,
	initializeApp
} from 'firebase/app';

import {
	collection,
	query,
	getDocs,
	where,
	getFirestore,
	limit
} from 'firebase/firestore';

import {
	Card
} from '../src/types.js';

import {
	CARDS_COLLECTION
} from '../src/type_constants.js';

import {
	getProjectConfig,
	getFirebaseConfig
} from './util.js';

const SEO_PATH = 'seo/';
//How many characters to allow description to be
const MAX_DESCRIPTION_LENGTH = 200;

//The primary difference when this is flipped is the number of cards to fetch is
//small, because that fetching can take a long time.
const DEVELOPMENT_MODE = false;

type Rewrite = {
	source: string,
	destination: string
}

type FirebaseConfig = {
	hosting: {
		rewrites: Rewrite[]
	}
}

const log = (msg : string) => console.log(msg);

const fetchCards = async (config : FirebaseOptions) : Promise<Card[]> => {
	// Initialize Firebase
	const firebaseApp = initializeApp(config);
	const db = getFirestore(firebaseApp);
	let q = query(collection(db, CARDS_COLLECTION), where('published', '==', true));
	if (DEVELOPMENT_MODE) q = query(collection(db, CARDS_COLLECTION), where('published', '==', true), limit(5));
	const docs = await getDocs(q);
	const result : Card[] = [];
	for (const doc of docs.docs) {
		result.push({
			...doc.data(),
			id: doc.id
		} as Card);
	}
	return result;
};

const saveSEOForCard = (config : Config, rawContent : string, card : Card) => {
	const name = card.name;
	const fileName = path.join(SEO_PATH, name + '.html');
	log(`Creating ${fileName}`);
	const title = card.title || config.app_title;
	let description = striptags(card.body) || config.app_description;
	description = description.split('\n').join(' ');
	description = description.slice(0, MAX_DESCRIPTION_LENGTH);
	let content = rawContent.split('@TITLE@').join(title);
	content = content.split('@DESCRIPTION@').join(description);
	fs.writeFileSync(fileName, content);
};

const createSEOEndpoints = (config : Config, cards : Card[]) => {
	if(fs.existsSync(SEO_PATH)) {
		log(`Removing ${SEO_PATH}`);
		fs.rmSync(SEO_PATH, {recursive: true, force: true});
	}
	fs.mkdirSync(SEO_PATH);
	const indexContent = fs.readFileSync('index.PARTIAL.html').toString();
	for (const card of cards) {
		saveSEOForCard(config, indexContent, card);
	}
};

const updateFirebaseConfig = () => {
	log('Updating rewrite rules in firebase.json');
	const config = JSON.parse(fs.readFileSync('firebase.TEMPLATE.json').toString()) as FirebaseConfig;
	if (fs.existsSync(SEO_PATH)) {
		const files = fs.readdirSync(SEO_PATH);
		const rewrites : Rewrite[] = config.hosting.rewrites;
		for (const file of files) {
			const baseFileName = path.parse(file).name;
			//TODO: verify these rules work OK
			rewrites.unshift({
				source: '/c/**/' + baseFileName,
				destination: '/' + path.join(SEO_PATH, file)
			});
		}
	}
	fs.writeFileSync('firebase.json', JSON.stringify(config, null, '\t'));
};

const generatePages = async () => {
	const json = getProjectConfig();
	if (!json.seo) {
		console.log('SEO mode is not enabled in config');
		process.exit(0);
	}
	const firebaseConfig = await getFirebaseConfig(json);
	log('Fetching cards');
	//TODO: support a limit on how many cards to fetch.
	const cards = await fetchCards(firebaseConfig);
	log(`Fetched ${cards.length} cards`);
	createSEOEndpoints(json, cards);
};

const COMMAND_PAGES = 'pages';
const COMMAND_CONFIG = 'config';
const COMMAND_ALL = 'all';

const DEFAULT_ARGS = {
	[COMMAND_PAGES]: true,
	[COMMAND_CONFIG]: true
};

(async() => {

	let args = Object.fromEntries(process.argv.slice(2).map(item => [item, true]));

	if (Object.keys(args).length == 0 || args[COMMAND_ALL]) {
		args = DEFAULT_ARGS;
	}

	if (args[COMMAND_PAGES]) {
		await generatePages();
	}

	if (args[COMMAND_CONFIG]) {
		updateFirebaseConfig();
	}

	process.exit(0);
})();

