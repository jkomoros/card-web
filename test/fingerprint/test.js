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

const CONCEPT_MAP = {
	'Hill climbing': 'concept-hill-climbing',
	'Complexity': 'concept-complexity',
};

//TODO: actually model useful fallback text to test
const FALLBACK_TEXT_MAP = undefined;

const SYNONYM_MAP = {
	'Ambiguity': ['Uncertainty']
};

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
		cards[id] = cardWithNormalizedTextProperties(card, FALLBACK_TEXT_MAP, CONCEPT_MAP, SYNONYM_MAP);
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
				'concept_references': [],
				'non_link_references': [],
				'references_info_inbound': [],
				'title_alternates': [],
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
				],
				'concept_references': [],
				'non_link_references': [],
				'title_alternates': [],
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
				'concept_references': [],
				'non_link_references': [],
				'references_info_inbound': [],
				'title_alternates': [],
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
				'concept_references': [],
				'non_link_references': [],
				'references_info_inbound': [],
				'title_alternates': [],
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
				'concept_references': [],
				'non_link_references': [],
				'references_info_inbound': [],
				'title_alternates': [],
			},
		};
		for (let cardID of CARD_IDS_TO_TEST) {
			let card = cards[cardID];
			let normalized = expectedNormalized[cardID];
			assert.deepStrictEqual(Object.fromEntries(Object.entries(card.nlp).map(entry => [entry[0], entry[1].map(run => run.stemmed)])), normalized);
		}
	});

	it('fingerprints', async () => {
		const cards = baseCards();
		const generator = new FingerprintGenerator(cards);
		const expectFingerprints = {
			[CARD_ID_ONE]: new Map([
				[ 'crystal', 0.13340510852625595 ],
				[ 'card', 0.07798884360728828 ],
				[ 'titl', 0.07657239018653719 ],
				[ 'surf', 0.07657239018653719 ],
				[ 'thi card', 0.07339501271086321 ],
				[ 'bodi', 0.07079890628307223 ],
				[ 'seed', 0.060929070359663016 ],
				[ 'uncertainti', 0.060929070359663016 ],
				[ 'gradient', 0.05229820364574231 ],
				[ 'concept', 0.048864257727053356 ],
				[ 'kei', 0.046099638523773495 ],
				[ 'thi titl', 0.04033437110324073 ],
				[ 'titl thi', 0.04033437110324073 ],
				[ 'thi bodi', 0.04033437110324073 ],
				[ 'bodi thi', 0.04033437110324073 ],
				[ 'seed crystal', 0.04033437110324073 ],
				[ 'crystal crystal', 0.04033437110324073 ],
				[ 'crystal gradient', 0.04033437110324073 ],
				[ 'gradient surf', 0.04033437110324073 ],
				[ 'surf down', 0.04033437110324073 ],
				[ 'down them', 0.04033437110324073 ],
				[ 'them lot', 0.04033437110324073 ],
				[ 'lot complex', 0.04033437110324073 ],
				[ 'kei concept', 0.04033437110324073 ],
				[ 'concept understand', 0.04033437110324073 ],
				[ 'understand uncertainti', 0.04033437110324073 ],
				[ 'complex kei', 0.038286195093268596 ],
				[ 'lot', 0.03754512139406861 ],
				[ 'down', 0.037093046492900315 ],
				[ 'understand', 0.02990859104106808 ],
				[ 'thi', 0.028832444460994686 ],
				[ 'thi titl thi card', 0.020816212158568107 ],
				[ 'thi bodi thi card', 0.020816212158568107 ],
				[ 'them', 0.015382641364104568 ],
				[ 'complex', 0.01064701755074135 ]
			]),
			[CARD_ID_TWO]: new Map([
				[ 'cynefin', 0.041622566274161825 ],
				[ 'model', 0.04002263553189152 ],
				[ 'terminolog', 0.023969293509492947 ],
				[ 'call', 0.023655341325818455 ],
				[ 'unknow', 0.019265649282132872 ],
				[ 'chaotic', 0.019265649282132872 ],
				[ 'cynefin model', 0.018876135201266624 ],
				[ 'complic', 0.018427457688256908 ],
				[ 'requir', 0.015407775879021243 ],
				[ 'cynefin\'', 0.014446131344470418 ],
				[ 'blammo', 0.014446131344470418 ],
				[ 'cynenfin', 0.014446131344470418 ],
				[ 'hard', 0.013813483799929822 ],
				[ 'divid', 0.01335690706165177 ],
				[ 'four', 0.01335690706165177 ],
				[ 'method', 0.01335690706165177 ],
				[ 'inscrut', 0.01335690706165177 ],
				[ 'i’v', 0.01335690706165177 ],
				[ 'cynfefin’', 0.01335690706165177 ],
				[ 'unknow hard', 0.012942803208266535 ],
				[ 'knowabl', 0.01258409013417775 ],
				[ 'unclear', 0.01258409013417775 ],
				[ 'intric', 0.011984646754746473 ],
				[ 'distinguish', 0.011984646754746473 ],
				[ 'special', 0.011494865851359105 ],
				[ 'dupe', 0.010722048923885083 ],
				[ 'diagnos', 0.010405641568540456 ],
				[ 'simpl', 0.010122605544453806 ],
				[ 'past', 0.010122605544453806 ],
				[ 'ambigu', 0.010122605544453806 ],
				[ 'shift', 0.010122605544453806 ],
				[ 'trivial', 0.009866568316670972 ],
				[ 'consist', 0.009866568316670972 ],
				[ 'differ', 0.009564928283293726 ],
				[ 'next', 0.00941780130338059 ]
			]),
			[CARD_ID_THREE]: new Map([
				[ 'let', 0.03557567602834802 ],
				[ 'go', 0.026261076535471568 ],
				[ 'let go', 0.023464865575794813 ],
				[ 'detail', 0.02027371922841282 ],
				[ 'truth', 0.020074180581411468 ],
				[ 'attent', 0.016051257049411575 ],
				[ 'complex', 0.015622943278922873 ],
				[ 'becom', 0.014847909217678052 ],
				[ 'unnatur', 0.014841007846279746 ],
				[ 'cosmic', 0.014841007846279746 ],
				[ 'calm', 0.014841007846279746 ],
				[ 'uncomfort', 0.014841007846279746 ],
				[ 'onli', 0.014066915194103928 ],
				[ 'pai', 0.013982322371308612 ],
				[ 'type', 0.013787208807886996 ],
				[ 'go detail', 0.013630758643147917 ],
				[ 'latter', 0.013316274171940526 ],
				[ 'embrac', 0.012772073168176783 ],
				[ 'scari', 0.012772073168176783 ],
				[ 'import', 0.012538996931306891 ],
				[ 'correctli', 0.01231195777552652 ],
				[ 'solut', 0.012104646607297239 ],
				[ 'diagnos', 0.011561823965044953 ],
				[ 'illus', 0.011247339493837561 ],
				[ 'gradient', 0.010962853685189969 ],
				[ 'bias', 0.010962853685189969 ],
				[ 'littl', 0.010962853685189969 ],
				[ 'evid', 0.010464223670422877 ],
				[ 'ever', 0.010243023097423556 ],
				[ 'broader', 0.010037090290705734 ],
				[ 'problem space', 0.009990050963540326 ],
				[ 'certain', 0.009844453015102686 ],
				[ 'awai', 0.009663498109794442 ],
				[ 'they\'r', 0.009492889286941988 ],
				[ 'both', 0.009331507184883412 ]
			]),
			[CARD_ID_FOUR]: new Map([
				[ 'truth', 0.06861019730869028 ],
				[ 'ground', 0.02536204335872021 ],
				[ 'land', 0.022756400806702715 ],
				[ 'true', 0.019030377919692094 ],
				[ 'you\'v', 0.018734601677930594 ],
				[ 'ever', 0.017504471300872595 ],
				[ 'it\'', 0.015649797052215888 ],
				[ 'there not', 0.013715129102609677 ],
				[ 'ground truth', 0.013715129102609677 ],
				[ 'modern', 0.013715129102609677 ],
				[ 'truth as', 0.013715129102609677 ],
				[ 'land at', 0.013715129102609677 ],
				[ 'not', 0.01351752486389841 ],
				[ 'process', 0.012830613902355957 ],
				[ 'motion', 0.012681021679360105 ],
				[ 'subject', 0.012681021679360105 ],
				[ 'incorpor', 0.011947310786094177 ],
				[ 'learn', 0.011436586841598803 ],
				[ 'inconveni', 0.010913203362844605 ],
				[ 'asymptot', 0.010913203362844605 ],
				[ 'later', 0.010913203362844605 ],
				[ 'disconfirm', 0.0105200539669518 ],
				[ 'post', 0.0105200539669518 ],
				[ 'spectrum', 0.0105200539669518 ],
				[ 'outsid', 0.0105200539669518 ],
				[ 'directli', 0.0105200539669518 ],
				[ 'hill', 0.010179492469578675 ],
				[ 'longer', 0.010179492469578675 ],
				[ 'affect', 0.009879095939595033 ],
				[ 'climb', 0.009610382086835855 ],
				[ 'total', 0.009610382086835855 ],
				[ 'partial', 0.009610382086835855 ],
				[ 'nuanc', 0.009367300838965297 ],
				[ 'thu', 0.009145385046329104 ],
				[ 'moment', 0.009145385046329104 ]
			]),
			[CARD_ID_FIVE]: new Map([
				[ 'site', 0.06748020755105322 ],
				[ 'stuff', 0.06748020755105322 ],
				[ 'quot', 0.06054743412554208 ],
				[ 'hill', 0.05416868466754443 ],
				[ 'climb', 0.05114024676104267 ],
				[ 'https://www.wikipedia.org/blammo', 0.03649152969827163 ],
				[ 'impor', 0.03649152969827163 ],
				[ 'komoroske.com/sudoku', 0.03649152969827163 ],
				[ 'washingtonpost.com', 0.03649152969827163 ],
				[ 'same', 0.034531530603472194 ],
				[ 'hill climb', 0.03374010377552661 ],
				[ 'boundari', 0.03027371706277104 ],
				[ 'realli', 0.029036510093276905 ],
				[ 'here', 0.029036510093276905 ],
				[ 'edg', 0.027990466505298572 ],
				[ 'e.g', 0.02378975850072701 ],
				[ 'interest', 0.023286872823048865 ],
				[ 'think', 0.023089400158216374 ],
				[ 'about', 0.02291868466754443 ],
				[ 'great', 0.021214598365633382 ],
				[ 'card ha', 0.019221848728888158 ],
				[ 'lot interest', 0.019221848728888158 ],
				[ 'interest detail', 0.019221848728888158 ],
				[ 'https://www.wikipedia.org/blammo great', 0.019221848728888158 ],
				[ 'great site', 0.019221848728888158 ],
				[ 'site it\'', 0.019221848728888158 ],
				[ 'import think', 0.019221848728888158 ],
				[ 'think stuff', 0.019221848728888158 ],
				[ 'stuff e.g', 0.019221848728888158 ],
				[ 'e.g other', 0.019221848728888158 ],
				[ 'other stuff', 0.019221848728888158 ],
				[ 'climb same', 0.019221848728888158 ],
				[ 'as hill', 0.019221848728888158 ],
				[ 'climb thi', 0.019221848728888158 ],
				[ 'not not', 0.019221848728888158 ]
			])
		};
		for (let cardID of CARD_IDS_TO_TEST) {
			let expectedFingerprint = expectFingerprints[cardID];
			let fingerprint = generator.fingerprintForCardID(cardID);
			assert.deepStrictEqual(fingerprint.entries(), expectedFingerprint.entries());
		}
	});

	it('overlaps work with already-provided cards', async () => {
		const cards = baseCards();
		const generator = new FingerprintGenerator(cards);
		const expectedOverlaps = {
			[CARD_ID_ONE]: new Map([
				[ 'five', 1.1388039323032 ],
				[ 'three', 2.1696137408762 ],
				[ 'two', 1.0706030511152356 ],
				[ 'four', 0 ]
			]),
			[CARD_ID_TWO]: new Map([
				[ 'three', 3.1153684900849234 ],
				[ 'one', 1.0706030511152356 ],
				[ 'four', 1.020495429755342 ],
				[ 'five', 0 ]
			]),
			[CARD_ID_THREE]: new Map([
				[ 'four', 3.1615824542006523 ],
				[ 'two', 3.1153684900849234 ],
				[ 'one', 2.1696137408762 ],
				[ 'five', 0 ]
			]),
			[CARD_ID_FOUR]: new Map([
				[ 'five', 3.2436154469562153 ],
				[ 'three', 3.1615824542006523 ],
				[ 'one', 0 ],
				[ 'two', 1.020495429755342 ]
			]),
			[CARD_ID_FIVE]: new Map([
				[ 'four', 3.2436154469562153 ],
				[ 'one', 1.1388039323032 ],
				[ 'three', 0 ],
				[ 'two', 0 ]
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

	it('pretty fingerprint items with card', async () => {
		const cards = baseCards();
		const generator = new FingerprintGenerator(cards);
		const fingerprint = generator.fingerprintForCardID(CARD_ID_TWO);
		const pretty = fingerprint.prettyItems(false);
		const expectedPretty = [
			'Cynefin',
			'Model',
			'Terminology',
			'Called',
			'Cynefin Model',
			'Complex',
			'Complicated',
			'Chaotic',
			'Unknowably',
			'Require',
			'Unknowably Hard',
			'Problems',
			'Hard',
			'Cynefin\'s',
			'Blammo',
			'Cynenfin',
			'Divides',
			'Four',
			'Methods',
			'Inscrutable',
			'I’ve',
			'Cynfefin’s',
			'Knowably',
			'Unclear',
			'Intricate',
			'Distinguishing',
			'Special',
			'Diagnosing',
			'Shifted',
			'Different',
			'Past',
			'Dupe',
			'What',
			'Simple',
			'Ambiguous',
			'Trivial',
			'Black',
			'White',
			'Consistently',
			'Cynefin\'s Model',
			'Model Blammo',
			'Cynenfin Model',
			'Model Dupe',
			'Use',
			'Effort',
			'Next',
			'Beware',
			'I',
			'Efficiency',
			'Using the Cynefin'		
		];
		assert.deepStrictEqual(pretty, expectedPretty);
	});

	it('pretty fingerprint items with multiple cards', async () => {
		const cards = baseCards();
		const generator = new FingerprintGenerator(cards);
		const fingerprint = generator.fingerprintForCardIDList([CARD_ID_TWO, CARD_ID_ONE, CARD_ID_FIVE]);
		const pretty = fingerprint.prettyItems(false);
		const expectedPretty = [
			'Crystals',
			'Card',
			'Title',
			'Surfing',
			'Body',
			'Site',
			'Stuff',
			'Seed',
			'Complex',
			'Quote',
			'Hill Climbing',
			'Gradients',
			'Hill',
			'Concept',
			'Climbing',
			'Title of This Card',
			'Body of This Card',
			'Seed Crystals',
			'Crystals Crystalize',
			'Crystalize Gradients',
			'Gradients Surfing',
			'Surfing Down Them',
			'Them a Lot',
			'Lot Complexity',
			'Key Concept',
			'Concept to Understand',
			'Understand and Uncertainty',
			'Uncertainty',
			'Complexity Is a Key',
			'Key',
			'Lots',
			'Cynefin',
			'Model',
			'Same',
			'Https://www.wikipedia.org/blammo',
			'Imporant',
			'Komoroske.com/sudoku',
			'Washingtonpost.com',
			'Understand',
			'Boundaries',
			'Really',
			'Here',
			'Edges',
			'Think',
			'Card Has Lots',
			'Lots of Interesting',
			'Interesting Details',
			'Https://www.wikipedia.org/blammo Is a Great',
			'Great Site',
			'Site It\'s'
		];
		assert.deepStrictEqual(pretty, expectedPretty);
	});

	it('pretty deduped fingerprint with card', async () => {
		const cards = baseCards();
		const generator = new FingerprintGenerator(cards);
		const fingerprint = generator.fingerprintForCardID(CARD_ID_TWO);
		const pretty = fingerprint.dedupedPrettyItemsFromCard();
		const expectedPretty = 'Cynefin Model Terminology Called Complex Complicated Chaotic Unknowably Require Hard Problems Cynefin\'s Blammo Cynenfin Divides Four Methods Inscrutable I’ve Cynfefin’s Knowably Unclear Intricate Distinguishing Special Diagnosing Shifted Different Past Dupe What Simple Ambiguous Trivial Black White Consistently Use Effort Next Beware I Efficiency Using';
		assert.deepStrictEqual(pretty, expectedPretty);
	});

	it('pretty deduped fingerprint with multiple cards', async () => {
		const cards = baseCards();
		const generator = new FingerprintGenerator(cards);
		const fingerprint = generator.fingerprintForCardIDList([CARD_ID_TWO, CARD_ID_THREE]);
		const pretty = fingerprint.dedupedPrettyItemsFromCard();
		const expectedPretty = 'Complex Cynefin Model Let Go Problem Terminology Truths Called Details Diagnosing Complicated Chaotic Unknowably Require Hard Attention Only Become Unnatural Cosmically Calm Uncomfortable Solutions Cynefin\'s Blammo Cynenfin Types Pay Latter Spaces Divides Four Methods Inscrutable I’ve Cynfefin’s Important Embracing Scary Knowably Unclear Correctly Gradients Intricate';
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

const runExtractOriginalNgramFromRunTest = (rawTarget, rawRun) => {

	const targetNgram = TESTING.fullyNormalizedString(rawTarget);
	const run = TESTING.processedRun(rawRun);

	return TESTING.extractOriginalNgramFromRun(targetNgram, run);
};

describe('extractOriginalNgramFromRun', () => {

	it('returns nothing if total no op', () => {
		const rawTarget = '';
		const rawRun = '';
		const expected = '';
		const result = runExtractOriginalNgramFromRunTest(rawTarget, rawRun);
		assert.deepStrictEqual(result,expected);
	});

	it('returns nothing if target not in run', () => {
		const rawTarget = 'boo';
		const rawRun = 'Foo-bar bazzle! is fizz.';
		const expected = '';
		const result = runExtractOriginalNgramFromRunTest(rawTarget, rawRun);
		assert.deepStrictEqual(result,expected);
	});

	it('returns word if single word match', () => {
		const rawTarget = 'run';
		const rawRun = 'Foo-bar running! is fizz.';
		const expected = 'running';
		const result = runExtractOriginalNgramFromRunTest(rawTarget, rawRun);
		assert.deepStrictEqual(result,expected);
	});

	it('returns multiple words if single word match', () => {
		const rawTarget = 'foo bar running';
		const rawRun = 'Foo-bar running! is fizz.';
		const expected = 'foo bar running';
		const result = runExtractOriginalNgramFromRunTest(rawTarget, rawRun);
		assert.deepStrictEqual(result,expected);
	});

	it('returns multiple words ignoring earlier partial match', () => {
		const rawTarget = 'running bar';
		const rawRun = 'Foo-baz running! foo running bar fizz.';
		const expected = 'running bar';
		const result = runExtractOriginalNgramFromRunTest(rawTarget, rawRun);
		assert.deepStrictEqual(result,expected);
	});

	it('returns multiple words if single word match, including intervening stop words', () => {
		//you and is are both stop words
		const rawTarget = 'running you fizz';
		const rawRun = 'Foo-bar running! is fizz.';
		const expected = 'running is fizz';
		const result = runExtractOriginalNgramFromRunTest(rawTarget, rawRun);
		assert.deepStrictEqual(result,expected);
	});

	it('returns multiple words if single word match, skipping an earlier partial match', () => {
		//you and is are both stop words
		const rawTarget = 'running you fizz';
		const rawRun = 'Foo-bar running! is bar running is is fizz';
		const expected = 'running is is fizz';
		const result = runExtractOriginalNgramFromRunTest(rawTarget, rawRun);
		assert.deepStrictEqual(result,expected);
	});

	it('returns the right words if there is an earlier partial match immediately lined up', () => {
		//you and is are both stop words
		const rawTarget = 'look bar';
		const rawRun = 'Foo looking to look to bar baz';
		const expected = 'look to bar';
		const result = runExtractOriginalNgramFromRunTest(rawTarget, rawRun);
		assert.deepStrictEqual(result,expected);
	});

	it('stop words outside of match don\'t get in infinite loop', () => {
		//you and is are both stop words
		const rawTarget = 'look bar';
		const rawRun = 'you looking bar baz';
		const expected = 'looking bar';
		const result = runExtractOriginalNgramFromRunTest(rawTarget, rawRun);
		assert.deepStrictEqual(result,expected);
	});

	it('words with regexp special characters dont break', () => {
		//you and is are both stop words
		const rawTarget = 'look(ing bar';
		const rawRun = 'you look(ing bar baz';
		const expected = 'look(ing bar';
		const result = runExtractOriginalNgramFromRunTest(rawTarget, rawRun);
		assert.deepStrictEqual(result,expected);
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