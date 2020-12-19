/*eslint-env node*/

import {
	JSDOM
} from 'jsdom';

import {
	overrideDocument
} from '../../src/document.js';

import {
	BASE_DATA
} from './data.js';

const dom = new JSDOM('');

overrideDocument(dom.window.document);

import {
	cardWithNormalizedTextProperties,
	FingerprintGenerator,
	PreparedQuery,
	TESTING,
	dedupedPrettyFingerprint,
	prettyFingerprintItems,
	extractFiltersFromQuery
} from '../../src/nlp.js';

import {
	CARD_TYPE_CONTENT,
	CARD_TYPE_WORKING_NOTES,
	REFERENCE_TYPE_LINK,
	REFERENCE_TYPE_ACK,
	REFERENCE_TYPE_DUPE_OF,
	TEXT_FIELD_CONFIGURATION,
	TEXT_FIELD_TITLE,
} from '../../src/card_fields.js';

import assert from 'assert';

const CARD_ID_ONE = 'one';
const CARD_ID_TWO = 'two';
const CARD_ID_THREE = 'three';
const CARD_ID_FOUR = 'four';
const CARD_ID_FIVE = 'five';

const CARD_IDS_TO_TEST = [CARD_ID_ONE, CARD_ID_TWO, CARD_ID_THREE, CARD_ID_FOUR, CARD_ID_FIVE];

const baseCards = (extras) => {
	if (!extras) extras = {};
	const cards = {
		...extras,
		...{
			[CARD_ID_ONE]: {
				'body': '<p>This is the body of this card.</p>\n<p>Seed crystals crystalize gradients <card-link card=\'two\'>surfing down</card-link> <strong>them</strong> a lot. Complexity is a key concept to understand and uncertainty.</p>',
				'title': 'This is the title of this card',
			},
			[CARD_ID_TWO]: {
				//Note: this one does not include newlines after block elements
				//Note: this is the content of card g487aed6370_0_25 from production
				'body': '<p>The <card-link href="https://en.wikipedia.org/wiki/Cynefin_framework">Cynefin model</card-link> divides problems into four types, each with different properties.</p><ul><li><strong>Simple</strong> - Trivial problem spaces that require no special effort.</li><li><strong>Complicated</strong> - Knowably hard. Intricate and challenging, but concrete and black and white. Efficiency will require a focus on the right process and structure.</li><li><strong>Complex</strong> - <em>Unknowably</em> hard. Goals, methods, and even possible next actions are unclear, meaning <card-link card="g487aed6370_0_61">fundamentally different approaches are required</card-link>.</li><li><strong>Chaotic</strong> - So unknowably hard as to be inscrutable--impossible to control or predict. <card-link card="g487aed6370_0_30">Beware diagnosing problems as chaotic</card-link> because it’s effectively giving up.</li></ul><p>Distinguishing between <card-link card="g487aed6370_0_45">complex and complicated</card-link> is the most important in practice.</p><p class="small"><em>Note on terminology: in the past I called what Cynefin calls “complex” “ambiguous”, and what it calls “complicated”, “complex”.  I’ve shifted to use Cynfefin’s terminology consistently.</em></p',
				'title': 'Using the cynefin model to understand problem spaces',
				'references_info_inbound': {
					'card_1': {
						[REFERENCE_TYPE_LINK]: 'cynefin model\ncynefin\'s model blammo',
					},
					'card_2': {
						[REFERENCE_TYPE_ACK]: '',
					},
					'card_3': {
						[REFERENCE_TYPE_DUPE_OF]: 'cynenfin model dupe',
					}
				}
			},
			[CARD_ID_THREE]: {
				'body': '<p>Gradients are important and you should pay attention to them! They\'re an important type of complexity.</p><p><card-link card="g487aed6370_0_55">Humans are biased away from complex problem spaces.</card-link> But correctly diagnosing a problem space as complex is only the first step.</p><p>In complex problem spaces, you <strong>have to let go of the </strong><strong><card-link card="g487aed6370_0_76">details that don’t matter</card-link></strong>, because they’re <card-link card="g487aed6370_0_71">a dangerous illusion</card-link>. Doing this is hard, unnatural, and a little scary. But it’s the only way to see broader truths.</p><p>You have to l<strong>et go of ever having solutions that are </strong><strong><em>both</em></strong><strong> detailed and clear.</strong> You can have one but not the other (and generally only the latter). When you let go, you can become <strong>cosmically calm</strong>, and high-level truths will become evident.</p><p>Certain types of solutions are fundamentally impossible in complexity, although people who are uncomfortable with complexity will continue to demand them.</p>',
				'title': 'Embracing complexity means letting go of details',
			},
			[CARD_ID_FOUR]: {
				'card_type': CARD_TYPE_WORKING_NOTES,
				'body': '<p>Hill climbing is totally a thing.</p><p>There is not one truth</p><p>(just as there is not one cause, or one solution)</p><p>Truth is a mindset, a process. Seeking disconfirming evidence, incorporating it into an ever-more nuanced model. Ground-truthing even when it\'s inconvenient.</p><p>(Make sure to make it not "any truth is as good as any other" post modernism). Things can be more or less true, it\'s that there\'s a <em>spectrum</em>.</p><p>Truth is an asymptotic ideal, what matters is motion towards the goal, not ever landing at it. And if you think you\'ve landed at it, and thus no longer have more growth to do, you\'re wrong... and dangerous, because you\'ve stopped learning</p><p>Learning as the process of truth discovery.</p><p>Truth as being a partially situated context. What is true for you in your personal development in the moment might not be true for you later.</p><p>The more it exists outside and generally and directly affects others, the more that it\'s ground-truthed and not subjective.</p>',
				//This title should be skipped since it's a working notes card
				'title': '11/4/20 Truth Landing Ground True You\'ve Ever Incorporating Process',
			},
			[CARD_ID_FIVE]: {
				'body': '<p>https://www.wikipedia.org/blammo is a great site. It\'s important to think of stuff (e.g. other stuff).</p><p>hill-climbing is the same as hill climbing. This is not--not really--the same. This is a quote: "a quote is here". Boundaries/edges are imporant to think about</p><p>Anothe site to know about is komoroske.com/sudoku, or even washingtonpost.com</p>',
				'title': 'This card has lots of interesting details',
			},
		},
		//We extend with BASE_DATA, primarily to give good background IDF for
		//the other calculations.
		...BASE_DATA,
	};

	for (let [id, card] of Object.entries(cards)) {
		if (!card.card_type) card.card_type = CARD_TYPE_CONTENT;
		cards[id] = cardWithNormalizedTextProperties(card);
	}

	return cards;
};

describe('fingerprint generation', () => {
	it('Normalized properties', async () => {
		const cards = baseCards();
		const expectedNormalized = {
			[CARD_ID_ONE]: {
				'body': [
					'thi is the bodi of thi card',
					'seed crystal crystal gradient surf down them a lot complex is a kei concept to understand and uncertainti',
				],
				'title': ['thi is the titl of thi card'],
				'subtitle': [],
				'references_info_inbound': [],
			},
			[CARD_ID_TWO]: {
				'title': [
					'us the cynefin model to understand problem space'
				],
				'body': [
					'the cynefin model divid problem into four type each with differ properti',
					'simpl trivial problem space that requir no special effort',
					'complic knowabl hard intric and challeng but concret and black and white effici will requir a focu on the right process and structur',
					'complex unknow hard goal method and even possibl next action ar unclear mean fundament differ approach ar requir',
					'chaotic so unknow hard as to be inscrut imposs to control or predict bewar diagnos problem as chaotic becaus it’ effect give up',
					'distinguish between complex and complic is the most import in practic',
					'note on terminolog in the past i call what cynefin call complex ambigu and what it call complic complex i’v shift to us cynfefin’ terminolog consist'
				],
				'subtitle': [],
				'references_info_inbound': [
					'cynefin model',
					'cynefin\' model blammo',
					'cynenfin model dupe'
				]
			},
			[CARD_ID_THREE]: {
				'title': [
					'embrac complex mean let go of detail'
				],
				'body': [
					'gradient ar import and you should pai attent to them they\'r an import type of complex',
					'human ar bias awai from complex problem space but correctli diagnos a problem space as complex is onli the first step',
					'in complex problem space you have to let go of the detail that don’t matter becaus they’r a danger illus do thi is hard unnatur and a littl scari but it’ the onli wai to see broader truth',
					'you have to let go of ever have solut that ar both detail and clear you can have on but not the other and gener onli the latter when you let go you can becom cosmic calm and high level truth will becom evid',
					'certain type of solut ar fundament imposs in complex although peopl who ar uncomfort with complex will continu to demand them'
				],
				'subtitle': [],
				'references_info_inbound': []
			},
			[CARD_ID_FOUR]: {
				'title': [],
				'body': [
					'hill climb is total a thing',
					'there is not on truth',
					'just as there is not on caus or on solut',
					'truth is a mindset a process seek disconfirm evid incorpor it into an ever more nuanc model ground truth even when it\' inconveni',
					'make sure to make it not ani truth is as good as ani other post modern thing can be more or less true it\' that there\' a spectrum',
					'truth is an asymptot ideal what matter is motion toward the goal not ever land at it and if you think you\'v land at it and thu no longer have more growth to do you\'r wrong and danger becaus you\'v stop learn',
					'learn as the process of truth discoveri',
					'truth as be a partial situat context what is true for you in your person develop in the moment might not be true for you later',
					'the more it exist outsid and gener and directli affect other the more that it\' ground truth and not subject'
				],
				'subtitle': [],
				'references_info_inbound': []
			},
			[CARD_ID_FIVE]: {
				'title': [
					'thi card ha lot of interest detail'
				],
				'body': [
					'https://www.wikipedia.org/blammo is a great site it\' import to think of stuff e.g other stuff',
					'hill climb is the same as hill climb thi is not not realli the same thi is a quot a quot is here boundari edg ar impor to think about',
					'anoth site to know about is komoroske.com/sudoku or even washingtonpost.com'
				],
				'subtitle': [],
				'references_info_inbound': []
			},
		};
		for (let cardID of CARD_IDS_TO_TEST) {
			let card = cards[cardID];
			let normalized = expectedNormalized[cardID];
			assert.deepStrictEqual(card.normalized, normalized);
		}
	});

	it('fingerprints', async () => {
		const cards = baseCards();
		const generator = new FingerprintGenerator(cards);
		const expectFingerprints = {
			[CARD_ID_ONE]: new Map([
				[ 'crystal', 0.13125341322744535 ],
				[ 'card', 0.07673095903297716 ],
				[ 'titl', 0.07533735163514142 ],
				[ 'surf', 0.07533735163514142 ],
				[ 'thi card', 0.07221122218326863 ],
				[ 'bodi', 0.06965698843979687 ],
				[ 'seed', 0.05994634341837812 ],
				[ 'uncertainti', 0.05994634341837812 ],
				[ 'gradient', 0.051454684232101304 ],
				[ 'concept', 0.048076124537907335 ],
				[ 'kei', 0.04535609596693843 ],
				[ 'thi titl', 0.03968381673060781 ],
				[ 'titl thi', 0.03968381673060781 ],
				[ 'thi bodi', 0.03968381673060781 ],
				[ 'bodi thi', 0.03968381673060781 ],
				[ 'card seed', 0.03968381673060781 ],
				[ 'seed crystal', 0.03968381673060781 ],
				[ 'crystal crystal', 0.03968381673060781 ],
				[ 'crystal gradient', 0.03968381673060781 ],
				[ 'gradient surf', 0.03968381673060781 ],
				[ 'surf down', 0.03968381673060781 ],
				[ 'down them', 0.03968381673060781 ],
				[ 'them lot', 0.03968381673060781 ],
				[ 'lot complex', 0.03968381673060781 ],
				[ 'kei concept', 0.03968381673060781 ],
				[ 'concept understand', 0.03968381673060781 ],
				[ 'understand uncertainti', 0.03968381673060781 ],
				[ 'card thi', 0.03766867581757071 ],
				[ 'complex kei', 0.03766867581757071 ],
				[ 'lot', 0.03693955491997073 ],
				[ 'down', 0.03649477154946643 ],
				[ 'understand', 0.02942619441137343 ],
				[ 'thi', 0.028367405034204447 ],
				[ 'them', 0.015134534245328688 ],
				[ 'complex', 0.010475291461213261 ]
			]),
			[CARD_ID_TWO]: new Map([
				[ 'cynefin', 0.04053603341961544 ],
				[ 'model', 0.03897786793768552 ],
				[ 'terminolog', 0.02334358906044996 ],
				[ 'call', 0.02303783241570673 ],
				[ 'unknow', 0.01876273072657519 ],
				[ 'chaotic', 0.01876273072657519 ],
				[ 'cynefin model', 0.018383384683964485 ],
				[ 'complic', 0.01794641963615382 ],
				[ 'requir', 0.015005564862099004 ],
				[ 'cynefin\'', 0.014069023498128821 ],
				[ 'blammo', 0.014069023498128821 ],
				[ 'cynenfin', 0.014069023498128821 ],
				[ 'hard', 0.013452890849329246 ],
				[ 'divid', 0.013008232780925923 ],
				[ 'four', 0.013008232780925923 ],
				[ 'method', 0.013008232780925923 ],
				[ 'inscrut', 0.013008232780925923 ],
				[ 'i’v', 0.013008232780925923 ],
				[ 'cynfefin’', 0.013008232780925923 ],
				[ 'unknow hard', 0.012604938867488494 ],
				[ 'knowabl', 0.012255589789309658 ],
				[ 'unclear', 0.012255589789309658 ],
				[ 'intric', 0.01167179453022498 ],
				[ 'distinguish', 0.01167179453022498 ],
				[ 'special', 0.01119479907210676 ],
				[ 'dupe', 0.010442156080490494 ],
				[ 'diagnos', 0.01013400835490386 ],
				[ 'simpl', 0.009858360821405815 ],
				[ 'past', 0.009858360821405815 ],
				[ 'ambigu', 0.009858360821405815 ],
				[ 'shift', 0.009858360821405815 ],
				[ 'trivial', 0.009609007296356269 ],
				[ 'consist', 0.009609007296356269 ],
				[ 'differ', 0.0093152414003965 ],
				[ 'next', 0.009171955084617643 ]
			]),
			[CARD_ID_THREE]: new Map([
				[ 'let', 0.0349747355548962 ],
				[ 'go', 0.025817477269669684 ],
				[ 'let go', 0.023068499603230715 ],
				[ 'detail', 0.0199312577549599 ],
				[ 'truth', 0.01973508969321195 ],
				[ 'attent', 0.015780120950603948 ],
				[ 'complex', 0.015359042210022149 ],
				[ 'becom', 0.01459709994035241 ],
				[ 'unnatur', 0.01459031514617367 ],
				[ 'cosmic', 0.01459031514617367 ],
				[ 'calm', 0.01459031514617367 ],
				[ 'uncomfort', 0.01459031514617367 ],
				[ 'onli', 0.013829298383392715 ],
				[ 'pai', 0.013746134493414885 ],
				[ 'type', 0.013554316767213229 ],
				[ 'go detail', 0.013400509341743392 ],
				[ 'latter', 0.013091337108225316 ],
				[ 'embrac', 0.012556328688984607 ],
				[ 'scari', 0.012556328688984607 ],
				[ 'import', 0.012327189550710493 ],
				[ 'correctli', 0.012103985515804789 ],
				[ 'solut', 0.011900176225417218 ],
				[ 'diagnos', 0.01136652288455433 ],
				[ 'illus', 0.011057350651036253 ],
				[ 'gradient', 0.010777670345913112 ],
				[ 'bias', 0.010777670345913112 ],
				[ 'littl', 0.010777670345913112 ],
				[ 'evid', 0.010287463135449518 ],
				[ 'ever', 0.010069999058615726 ],
				[ 'broader', 0.009867544846605975 ],
				[ 'problem space', 0.009821300102669713 ],
				[ 'certain', 0.009678161579036762 ],
				[ 'awai', 0.009500263344426295 ],
				[ 'they\'r', 0.009332536427365265 ],
				[ 'both', 0.00917388037432795 ]
			]),
			[CARD_ID_FOUR]: new Map([
				[ 'truth', 0.06733817347770302 ],
				[ 'ground', 0.0248918344856911 ],
				[ 'land', 0.022334500196165376 ],
				[ 'true', 0.01867755727238176 ],
				[ 'you\'v', 0.01838726468236473 ],
				[ 'ever', 0.017179940757061987 ],
				[ 'it\'', 0.015359651919547523 ],
				[ 'modern', 0.013460852453541118 ],
				[ 'there not', 0.013460852453541118 ],
				[ 'ground truth', 0.013460852453541118 ],
				[ 'truth as', 0.013460852453541118 ],
				[ 'land at', 0.013460852453541118 ],
				[ 'not', 0.013266911770840542 ],
				[ 'process', 0.012592736046145128 ],
				[ 'motion', 0.01244591724284555 ],
				[ 'subject', 0.01244591724284555 ],
				[ 'incorpor', 0.011725809250866876 ],
				[ 'learn', 0.01122455405961719 ],
				[ 'inconveni', 0.010710874040171308 ],
				[ 'asymptot', 0.010710874040171308 ],
				[ 'later', 0.010710874040171308 ],
				[ 'disconfirm', 0.010325013581205236 ],
				[ 'post', 0.010325013581205236 ],
				[ 'spectrum', 0.010325013581205236 ],
				[ 'outsid', 0.010325013581205236 ],
				[ 'directli', 0.010325013581205236 ],
				[ 'hill', 0.009990766048192632 ],
				[ 'longer', 0.009990766048192632 ],
				[ 'affect', 0.009695938829475738 ],
				[ 'climb', 0.009432206895408446 ],
				[ 'total', 0.009432206895408446 ],
				[ 'partial', 0.009432206895408446 ],
				[ 'nuanc', 0.009193632341182366 ],
				[ 'thu', 0.008975830837497064 ],
				[ 'moment', 0.008975830837497064 ]
			]),
			[CARD_ID_FIVE]: new Map([
				[ 'site', 0.06593485928652527 ],
				[ 'stuff', 0.06593485928652527 ],
				[ 'quot', 0.0591608516646518 ],
				[ 'hill', 0.05292818043851669 ],
				[ 'climb', 0.04996909607185848 ],
				[ 'https://www.wikipedia.org/blammo', 0.03565584581205167 ],
				[ 'impor', 0.03565584581205167 ],
				[ 'komoroske.com/sudoku', 0.03565584581205167 ],
				[ 'washingtonpost.com', 0.03565584581205167 ],
				[ 'same', 0.03374073219270565 ],
				[ 'hill climb', 0.03194534125195557 ],
				[ 'boundari', 0.0295804258323259 ],
				[ 'realli', 0.028371551846865982 ],
				[ 'here', 0.028371551846865982 ],
				[ 'edg', 0.02734946345555891 ],
				[ 'e.g', 0.023244954870939367 ],
				[ 'interest', 0.02275358565916225 ],
				[ 'think', 0.022560635269096914 ],
				[ 'about', 0.022393829293478527 ],
				[ 'great', 0.02072876786871048 ],
				[ 'card ha', 0.01878165371982965 ],
				[ 'lot interest', 0.01878165371982965 ],
				[ 'interest detail', 0.01878165371982965 ],
				[ 'detail https://www.wikipedia.org/blammo', 0.01878165371982965 ],
				[ 'https://www.wikipedia.org/blammo great', 0.01878165371982965 ],
				[ 'great site', 0.01878165371982965 ],
				[ 'site it\'', 0.01878165371982965 ],
				[ 'import think', 0.01878165371982965 ],
				[ 'think stuff', 0.01878165371982965 ],
				[ 'stuff e.g', 0.01878165371982965 ],
				[ 'e.g other', 0.01878165371982965 ],
				[ 'other stuff', 0.01878165371982965 ],
				[ 'stuff hill', 0.01878165371982965 ],
				[ 'climb same', 0.01878165371982965 ],
				[ 'as hill', 0.01878165371982965 ]
			])
		};
		for (let cardID of CARD_IDS_TO_TEST) {
			let expectedFingerprint = expectFingerprints[cardID];
			let fingerprint = generator.fingerprintForCardID(cardID);
			assert.deepStrictEqual(fingerprint, expectedFingerprint);
		}
	});

	it('overlaps work with already-provided cards', async () => {
		const cards = baseCards();
		const generator = new FingerprintGenerator(cards);
		const expectedOverlaps = {
			[CARD_ID_ONE]: new Map([
				[ 'three', 2.0880666882492496 ],
				[ 'two', 0 ],
				[ 'four', 0 ],
				[ 'five', 0 ]
			]),
			[CARD_ID_TWO]: new Map([
				[ 'three', 1.0215005312394583 ],
				[ 'one', 0 ],
				[ 'four', 0 ],
				[ 'five', 0 ]
			]),
			[CARD_ID_THREE]: new Map([
				[ 'four', 2.1143232029865926 ],
				[ 'one', 2.0880666882492496 ],
				[ 'two', 1.0215005312394583 ],
				[ 'five', 0 ]
			]),
			[CARD_ID_FOUR]: new Map([
				[ 'five', 2.122320249453976 ],
				[ 'three', 2.1143232029865926 ],
				[ 'one', 0 ],
				[ 'two', 0 ]
			]),
			[CARD_ID_FIVE]: new Map([
				[ 'four', 2.122320249453976 ],
				[ 'one', 0 ],
				[ 'two', 0 ],
				[ 'three', 0 ]
			]),
		};
		//Filter down to only cards in the test set so we don't compare like 300 fingerprints
		let filteredFingerprints = Object.fromEntries(Object.entries(generator.fingerprints()).filter(entry => CARD_IDS_TO_TEST.some(item => item == entry[0])));
		for (let cardID of CARD_IDS_TO_TEST) {
			let expectedOverlap = expectedOverlaps[cardID];
			let overlap = generator.closestOverlappingItems(cardID, null, filteredFingerprints);
			assert.deepStrictEqual(overlap, expectedOverlap);
		}
	});

	it('destemmed word map for card', async () => {
		const card = baseCards()[CARD_ID_TWO];
		let wordMap = TESTING.destemmedWordMap(card);
		//Filter out items that are the same on each side, to keep the expected map smaller.
		let filteredWordMap = Object.fromEntries(Object.entries(wordMap).filter(entry => entry[0] != entry[1]));
		let expectedWordMap = {
			us: 'using',
			space: 'spaces',
			divid: 'divides',
			type: 'types',
			differ: 'different',
			properti: 'properties',
			simpl: 'simple',
			requir: 'require',
			complic: 'complicated',
			knowabl: 'knowably',
			intric: 'intricate',
			challeng: 'challenging',
			concret: 'concrete',
			effici: 'efficiency',
			focu: 'focus',
			structur: 'structure',
			unknow: 'unknowably',
			goal: 'goals',
			method: 'methods',
			possibl: 'possible',
			action: 'actions',
			ar: 'are',
			mean: 'meaning',
			fundament: 'fundamentally',
			approach: 'approaches',
			inscrut: 'inscrutable',
			imposs: 'impossible',
			bewar: 'beware',
			diagnos: 'diagnosing',
			becaus: 'because',
			'it’': 'it’s',
			effect: 'effectively',
			give: 'giving',
			distinguish: 'distinguishing',
			import: 'important',
			practic: 'practice',
			terminolog: 'terminology',
			call: 'calls',
			ambigu: 'ambiguous',
			'i’v': 'i’ve',
			shift: 'shifted',
			'cynfefin’': 'cynfefin’s',
			consist: 'consistently',
			'cynefin\'': 'cynefin\'s'
		};
		assert.deepStrictEqual(filteredWordMap, expectedWordMap);
	});

	it('destemmed word map for corpus', async () => {
		let wordMap = TESTING.destemmedWordMap();
		//Filter out items that are the same on each side, to keep the expected map smaller, and only pick the first 100
		let filteredWordMap = Object.fromEntries(Object.entries(wordMap).filter(entry => entry[0] != entry[1]).slice(0, 100));
		let expectedWordMap = {
			thi: 'this',
			titl: 'title',
			card: 'cards',
			bodi: 'body',
			seed: 'seeds',
			crystal: 'crystals',
			surf: 'surfing',
			kei: 'key',
			uncertainti: 'uncertainty',
			us: 'use',
			space: 'spaces',
			divid: 'divides',
			type: 'types',
			differ: 'different',
			properti: 'properties',
			simpl: 'simple',
			requir: 'requires',
			complic: 'complicated',
			knowabl: 'knowably',
			intric: 'intricate',
			challeng: 'challenge',
			concret: 'concrete',
			effici: 'efficiency',
			focu: 'focus',
			structur: 'structure',
			unknow: 'unknowably',
			goal: 'goals',
			method: 'methods',
			possibl: 'possible',
			action: 'actions',
			ar: 'are',
			mean: 'means',
			fundament: 'fundamentally',
			inscrut: 'inscrutable',
			imposs: 'impossible',
			bewar: 'beware',
			diagnos: 'diagnosing',
			becaus: 'because',
			'it’': 'it’s',
			distinguish: 'distinguishing',
			import: 'important',
			practic: 'practice',
			terminolog: 'terminology',
			call: 'called',
			ambigu: 'ambiguity',
			'i’v': 'i’ve',
			'cynfefin’': 'cynfefin’s',
			consist: 'consistently',
			'cynefin\'': 'cynefin\'s',
			embrac: 'embracing',
			detail: 'details',
			pai: 'pay',
			attent: 'attention',
			'they\'r': 'they\'re',
			human: 'humans',
			bias: 'biased',
			awai: 'away',
			correctli: 'correctly',
			onli: 'only',
			'they’r': 'they’re',
			danger: 'dangerous',
			illus: 'illusion',
			unnatur: 'unnatural',
			littl: 'little',
			scari: 'scary',
			wai: 'way',
			solut: 'solutions',
			gener: 'general',
			becom: 'become',
			cosmic: 'cosmically',
			evid: 'evidence',
			peopl: 'people',
			uncomfort: 'uncomfortable',
			continu: 'continuous',
			climb: 'climbing',
			thing: 'things',
			caus: 'cause',
			disconfirm: 'disconfirming',
			incorpor: 'incorporating',
			nuanc: 'nuanced',
			'it\'': 'it\'s',
			inconveni: 'inconvenient',
			ani: 'any',
			modern: 'modernism',
			'there\'': 'there\'s',
			asymptot: 'asymptotically',
			toward: 'towards',
			'you\'v': 'you\'ve',
			thu: 'thus',
			'you\'r': 'you\'re',
			discoveri: 'discovery',
			partial: 'partially',
			situat: 'situation',
			develop: 'developers',
			outsid: 'outside',
			directli: 'directly',
			subject: 'subjective',
			ha: 'has',
			interest: 'interesting',
			realli: 'really'
		};
		assert.deepStrictEqual(filteredWordMap, expectedWordMap);
	});

	it('pretty fingerprint items with card', async () => {
		const cards = baseCards();
		const generator = new FingerprintGenerator(cards);
		const fingerprint = generator.fingerprintForCardID(CARD_ID_TWO);
		const pretty = prettyFingerprintItems(fingerprint, cards[CARD_ID_TWO]);
		const expectedPretty = [
			'Cynefin',
			'Model',
			'Terminology',
			'Calls',
			'Unknowably',
			'Chaotic',
			'Cynefin Model',
			'Complicated',
			'Require',
			'Cynefin\'s',
			'Blammo',
			'Cynenfin',
			'Hard',
			'Divides',
			'Four',
			'Methods',
			'Inscrutable',
			'I’ve',
			'Cynfefin’s',
			'Unknowably Hard',
			'Knowably',
			'Unclear',
			'Intricate',
			'Distinguishing',
			'Special',
			'Dupe',
			'Diagnosing',
			'Simple',
			'Past',
			'Ambiguous',
			'Shifted',
			'Trivial',
			'Consistently',
			'Different',
			'Next'
		];
		assert.deepStrictEqual(pretty, expectedPretty);
	});

	it('pretty fingerprint items with multiple cards', async () => {
		const cards = baseCards();
		const generator = new FingerprintGenerator(cards);
		const fingerprint = generator.fingerprintForCardID(CARD_ID_TWO);
		const pretty = prettyFingerprintItems(fingerprint, [cards[CARD_ID_TWO], cards[CARD_ID_ONE], cards[CARD_ID_FIVE]]);
		const expectedPretty = [
			'Cynefin',
			'Model',
			'Terminology',
			'Calls',
			'Unknowably',
			'Chaotic',
			'Cynefin Model',
			'Complicated',
			'Require',
			'Cynefin\'s',
			'Blammo',
			'Cynenfin',
			'Hard',
			'Divides',
			'Four',
			'Methods',
			'Inscrutable',
			'I’ve',
			'Cynfefin’s',
			'Unknowably Hard',
			'Knowably',
			'Unclear',
			'Intricate',
			'Distinguishing',
			'Special',
			'Dupe',
			'Diagnosing',
			'Simple',
			'Past',
			'Ambiguous',
			'Shifted',
			'Trivial',
			'Consistently',
			'Different',
			'Next'
		];
		assert.deepStrictEqual(pretty, expectedPretty);
	});

	it('pretty fingerprint items without card', async () => {
		const cards = baseCards();
		const generator = new FingerprintGenerator(cards);
		const fingerprint = generator.fingerprintForCardID(CARD_ID_TWO);
		const pretty = prettyFingerprintItems(fingerprint);
		const expectedPretty = [
			'Cynefin',
			'Model',
			'Terminology',
			'Called',
			'Unknowably',
			'Chaotic',
			'Cynefin Model',
			'Complicated',
			'Requires',
			'Cynefin\'s',
			'Blammo',
			'Cynenfin',
			'Hard',
			'Divides',
			'Four',
			'Methods',
			'Inscrutable',
			'I’ve',
			'Cynfefin’s',
			'Unknowably Hard',
			'Knowably',
			'Unclear',
			'Intricate',
			'Distinguishing',
			'Special',
			'Dupe',
			'Diagnosing',
			'Simple',
			'Past',
			'Ambiguity',
			'Shift',
			'Trivial',
			'Consistently',
			'Different',
			'Next'
		];
		assert.deepStrictEqual(pretty, expectedPretty);
	});

	it('pretty deduped fingerprint with card', async () => {
		const cards = baseCards();
		const generator = new FingerprintGenerator(cards);
		const fingerprint = generator.fingerprintForCardID(CARD_ID_TWO);
		const pretty = dedupedPrettyFingerprint(fingerprint, cards[CARD_ID_TWO]);
		const expectedPretty = 'Cynefin Model Terminology Calls Unknowably Chaotic Complicated Require Cynefin\'s Blammo Cynenfin Hard Divides Four Methods Inscrutable I’ve Cynfefin’s Knowably Unclear Intricate Distinguishing Special Dupe Diagnosing Simple Past Ambiguous Shifted Trivial Consistently Different Next';
		assert.deepStrictEqual(pretty, expectedPretty);
	});

	it('pretty deduped fingerprint with multiple cards', async () => {
		const cards = baseCards();
		const generator = new FingerprintGenerator(cards);
		const fingerprint = generator.fingerprintForCardID(CARD_ID_TWO);
		const pretty = dedupedPrettyFingerprint(fingerprint, [cards[CARD_ID_TWO],cards[CARD_ID_THREE]]);
		const expectedPretty = 'Cynefin Model Terminology Calls Unknowably Chaotic Complicated Require Cynefin\'s Blammo Cynenfin Hard Divides Four Methods Inscrutable I’ve Cynfefin’s Knowably Unclear Intricate Distinguishing Special Dupe Diagnosing Simple Past Ambiguous Shifted Trivial Consistently Different Next';
		assert.deepStrictEqual(pretty, expectedPretty);
	});

	it('pretty deduped fingerprint without card', async () => {
		const cards = baseCards();
		const generator = new FingerprintGenerator(cards);
		const fingerprint = generator.fingerprintForCardID(CARD_ID_TWO);
		const pretty = dedupedPrettyFingerprint(fingerprint);
		const expectedPretty = 'Cynefin Model Terminology Called Unknowably Chaotic Complicated Requires Cynefin\'s Blammo Cynenfin Hard Divides Four Methods Inscrutable I’ve Cynfefin’s Knowably Unclear Intricate Distinguishing Special Dupe Diagnosing Simple Past Ambiguity Shift Trivial Consistently Different Next';
		assert.deepStrictEqual(pretty, expectedPretty);
	});

});

//expandExpectedQueryProperties takes a titleBlock and then makes a body,
//subtitle, and references_info_inbound block that's the same but with different
//match weights.
const expandExpectedQueryProperties = (titleBlock) => {
	let result = {[TEXT_FIELD_TITLE]: titleBlock};
	let titleMatchWeight = TEXT_FIELD_CONFIGURATION[TEXT_FIELD_TITLE].matchWeight;
	for (let [fieldName, fieldConfig] of Object.entries(TEXT_FIELD_CONFIGURATION)) {
		if (fieldName == TEXT_FIELD_TITLE) continue;
		let fieldMatchWeight = fieldConfig.matchWeight;
		result[fieldName] = titleBlock.map(item => [item[0], item[1] / titleMatchWeight * fieldMatchWeight ,item[2]]);
	}
	return result;
};

describe('PreparedQuery', () => {
	it('Basic query parsing single word', async () => {
		const query = new PreparedQuery('foo');
		const expectedQueryProperties = expandExpectedQueryProperties([
			[
				[
					'foo'
				],
				1,
				true
			]
		]);

		assert.deepStrictEqual(query.text, expectedQueryProperties);
	});

	it('Basic query parsing two words one of them stop word', async () => {
		const query = new PreparedQuery('is foo');
		const expectedQueryProperties = expandExpectedQueryProperties(
			[
				[
					[
						'is foo'
					],
					1,
					true
				],
				[
					[
						'is',
						'foo'
					],
					0.5,
					true
				],
				[
					[
						'foo'
					],
					0.059640156839957804,
					false
				]
			]
		);

		assert.deepStrictEqual(query.text, expectedQueryProperties);
	});

	it('Basic query parsing two words', async () => {
		const query = new PreparedQuery('foo bar');
		const expectedQueryProperties = expandExpectedQueryProperties(
			[
				[
					[
						'foo bar'
					],
					1,
					true
				],
				[
					[
						'foo',
						'bar'
					],
					0.5,
					true
				],
				[
					[
						'foo'
					],
					0.059640156839957804,
					false
				],
				[
					[
						'bar'
					],
					0.059640156839957804,
					false
				]
			]
		);
		assert.deepStrictEqual(query.text, expectedQueryProperties);
	});

	it('Basic query parsing two words stemming', async () => {
		const query = new PreparedQuery('you\'re crystallizing');
		const expectedQueryProperties = expandExpectedQueryProperties([
			[
				[
					'you\'r crystal'
				],
				1,
				true
			],
			[
				[
					'you\'r',
					'crystal'
				],
				0.5,
				true
			],
			[
				[
					'you\'r'
				],
				0.08737125054200236,
				false
			],
			[
				[
					'crystal'
				],
				0.1056372550017821,
				false
			]
		]);
		assert.deepStrictEqual(query.text, expectedQueryProperties);
	});

	it('Basic query parsing one word one filter', async () => {
		const rawQuery = 'crystallizing filter:has-links';
		const expectedQueryFilters = ['has-links'];
		const expectedQueryWords = 'crystallizing';
		const result = extractFiltersFromQuery(rawQuery);
		assert.deepStrictEqual(result[0], expectedQueryWords);
		assert.deepStrictEqual(result[1], expectedQueryFilters);
	});

	it('Basic query parsing two words one filter', async () => {
		const rawQuery = 'crystallizing blammo filter:has-links';
		const expectedQueryFilters = ['has-links'];
		const expectedQueryWords = 'crystallizing blammo';
		const result = extractFiltersFromQuery(rawQuery);
		assert.deepStrictEqual(result[0], expectedQueryWords);
		assert.deepStrictEqual(result[1], expectedQueryFilters);

	});

	it('Basic query parsing two words one filter in between', async () => {
		const rawQuery = 'crystallizing filter:has-links blammo';
		const expectedQueryFilters = ['has-links'];
		const expectedQueryWords = 'crystallizing blammo';
		const result = extractFiltersFromQuery(rawQuery);
		assert.deepStrictEqual(result[0], expectedQueryWords);
		assert.deepStrictEqual(result[1], expectedQueryFilters);
	});

	it('Basic query parsing one hyphenated word one normal word', async () => {
		const query = new PreparedQuery('hill-climbing blammo');
		const expectedQueryText = expandExpectedQueryProperties(
			[
				[
					[
						'hill climb blammo'
					],
					1,
					true
				],
				[
					[
						'hill',
						'climb',
						'blammo'
					],
					0.5,
					true
				],
				[
					[
						'hill'
					],
					0.0752574989159953,
					false
				],
				[
					[
						'climb'
					],
					0.08737125054200236,
					false
				],
				[
					[
						'blammo'
					],
					0.09726890629795545,
					false
				],
				[
					[
						'hill climb'
					],
					0.75,
					false,
				],
				[
					[
						'climb blammo'
					],
					0.75,
					false,
				]
			],
		);
		assert.deepStrictEqual(query.text, expectedQueryText);
	});

	it('query matching two words hyphenated all match', async () => {
		const query = new PreparedQuery('hill-climbing blammo');
		const card = baseCards()[CARD_ID_FIVE];
		const result = query.cardScore(card);
		const expectedResult = [ 0.5049488278779766, true ];
		assert.deepStrictEqual(result, expectedResult);
	});

	it('query matching partial match', async () => {
		const query = new PreparedQuery('hill-climbing slammo');
		const card = baseCards()[CARD_ID_FIVE];
		const result = query.cardScore(card);
		const expectedResult = [ 0.45631437472899883, false ];
		assert.deepStrictEqual(result, expectedResult);
	});

	it('query matching partial match all words not right order', async () => {
		const query = new PreparedQuery('climbing hill');
		const card = baseCards()[CARD_ID_FIVE];
		const result = query.cardScore(card);
		const expectedResult = [ 0.33131437472899883, true ];
		assert.deepStrictEqual(result, expectedResult);
	});

});

describe('splitRuns', () => {
	it('undefined gives empty runs', async () => {
		const result = TESTING.splitRuns();
		const expectedResult = [];
		assert.deepStrictEqual(result, expectedResult);
	});

	it('empty string gives empty runs', async () => {
		const result = TESTING.splitRuns('');
		const expectedResult = [];
		assert.deepStrictEqual(result, expectedResult);
	});

	it('basic content gives one run', async () => {
		const result = TESTING.splitRuns('This is some super cool basic content');
		const expectedResult = ['This is some super cool basic content'];
		assert.deepStrictEqual(result, expectedResult);
	});

	it('basic content with a line break gives two run', async () => {
		const result = TESTING.splitRuns('This is some\nsuper cool basic content');
		const expectedResult = ['This is some','super cool basic content'];
		assert.deepStrictEqual(result, expectedResult);
	});

	it('trailing empty sections are removed', async () => {
		const result = TESTING.splitRuns('This is some\nsuper cool basic content\n');
		const expectedResult = ['This is some','super cool basic content'];
		assert.deepStrictEqual(result, expectedResult);
	});
});

describe('ngrams', () => {
	it('undefined gives empty ngrams', async () => {
		const result = TESTING.ngrams();
		const expectedResult = [];
		assert.deepStrictEqual(result, expectedResult);
	});

	it('empty string gives empty ngrams', async () => {
		const result = TESTING.ngrams('');
		const expectedResult = [];
		assert.deepStrictEqual(result, expectedResult);
	});

	it('string with one piece gives empty bigrams', async () => {
		const result = TESTING.ngrams('one');
		const expectedResult = [];
		assert.deepStrictEqual(result, expectedResult);
	});

	it('string with one piece gives single monogram', async () => {
		const result = TESTING.ngrams('one', 1);
		const expectedResult = ['one'];
		assert.deepStrictEqual(result, expectedResult);
	});

	it('string with multiple piece gives multiple monogram', async () => {
		const result = TESTING.ngrams('one two three', 1);
		const expectedResult = ['one', 'two', 'three'];
		assert.deepStrictEqual(result, expectedResult);
	});

	it('string with two piece gives one bigram', async () => {
		const result = TESTING.ngrams('one two');
		const expectedResult = ['one two'];
		assert.deepStrictEqual(result, expectedResult);
	});

	it('string with three piece gives two bigram', async () => {
		const result = TESTING.ngrams('one two three');
		const expectedResult = ['one two', 'two three'];
		assert.deepStrictEqual(result, expectedResult);
	});

	it('string with four piece gives two trigrams', async () => {
		const result = TESTING.ngrams('one two three four', 3);
		const expectedResult = ['one two three', 'two three four'];
		assert.deepStrictEqual(result, expectedResult);
	});

});