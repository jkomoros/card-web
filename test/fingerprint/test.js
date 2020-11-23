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
	cardSetNormalizedTextProperties,
	destemmedWordMap,
	FingerprintGenerator,
	PreparedQuery,
	TESTING,
} from '../../src/nlp.js';

import {
	CARD_TYPE_CONTENT,
	CARD_TYPE_WORKING_NOTES,
	REFERENCE_TYPE_LINK,
	REFERENCE_TYPE_ACK,
	REFERENCE_TYPE_DUPE_OF,
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

	for (let card of Object.values(cards)) {
		if (!card.card_type) card.card_type = CARD_TYPE_CONTENT;
		cardSetNormalizedTextProperties(card);
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
					'hill climb is the same as hill climb thi is not not realli the same thi is a quot a quot is here boundaries/edg ar impor to think about',
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
				[ 'crystal', 0.1271517440640877 ],
				[ 'card', 0.07433311656319663 ],
				[ 'titl', 0.07298305939654326 ],
				[ 'surf', 0.07298305939654326 ],
				[ 'bodi', 0.06748020755105322 ],
				[ 'seed', 0.05807302018655381 ],
				[ 'uncertainti', 0.05807302018655381 ],
				[ 'gradient', 0.04984672534984814 ],
				[ 'concept', 0.04657374564609773 ],
				[ 'kei', 0.04393871796797161 ],
				[ 'lot', 0.03578519382872165 ],
				[ 'down', 0.03535430993854561 ],
				[ 'understand', 0.028506625836018012 ],
				[ 'thi', 0.027480923626885558 ],
				[ 'them', 0.014661580050162167 ],
				[ 'complex', 0.010147938603050348 ],
				[ 'and', -0.008432723295366411 ],
				[ 'to', -0.016762712543712834 ],
				[ 'of', -0.02370567875222972 ],
				[ 'a', -0.02741837239158288 ],
				[ 'is', -0.034645317997870476 ],
				[ 'the', -0.03960780990892982 ]
			]),
			[CARD_ID_TWO]: new Map([
				[ 'cynefin', 0.04876073585258089 ],
				[ 'model', 0.046886420852578235 ],
				[ 'terminolog', 0.028079969449526763 ],
				[ 'call', 0.027712175224690706 ],
				[ 'unknow', 0.02256966159863392 ],
				[ 'chaotic', 0.02256966159863392 ],
				[ 'complic', 0.021587722171025607 ],
				[ 'requir', 0.01805017222542344 ],
				[ 'cynefin\'', 0.01692360797601003 ],
				[ 'blammo', 0.01692360797601003 ],
				[ 'cynenfin', 0.01692360797601003 ],
				[ 'hard', 0.01618246290571489 ],
				[ 'divid', 0.015647584359664516 ],
				[ 'four', 0.015647584359664516 ],
				[ 'method', 0.015647584359664516 ],
				[ 'inscrut', 0.015647584359664516 ],
				[ 'i’v', 0.015647584359664516 ],
				[ 'cynfefin’', 0.015647584359664516 ],
				[ 'knowabl', 0.014742231195836255 ],
				[ 'unclear', 0.014742231195836255 ],
				[ 'intric', 0.014039984724763381 ],
				[ 'distinguish', 0.014039984724763381 ],
				[ 'special', 0.01346620757949074 ],
				[ 'dupe', 0.012560854415662476 ],
				[ 'diagnos', 0.012190183963145222 ]
			]),
			[CARD_ID_THREE]: new Map([
				[ 'let', 0.03521265892601794 ],
				[ 'go', 0.025993106366742263 ],
				[ 'detail', 0.020066844542408604 ],
				[ 'truth', 0.019869342004050123 ],
				[ 'attent', 0.01588746871217268 ],
				[ 'complex', 0.015463525490362433 ],
				[ 'becom', 0.014696399939946644 ],
				[ 'unnatur', 0.014689568990705462 ],
				[ 'cosmic', 0.014689568990705462 ],
				[ 'calm', 0.014689568990705462 ],
				[ 'uncomfort', 0.014689568990705462 ],
				[ 'onli', 0.013923375243143684 ],
				[ 'pai', 0.013839645612417708 ],
				[ 'type', 0.013646523003724882 ],
				[ 'latter', 0.013180393823247255 ],
				[ 'embrac', 0.012641745890950488 ],
				[ 'scari', 0.012641745890950488 ],
				[ 'import', 0.01241104798302825 ],
				[ 'correctli', 0.012186325553327269 ],
				[ 'solut', 0.01198112980518196 ],
				[ 'diagnos', 0.011443846169483268 ],
				[ 'illus', 0.011132570723492281 ],
				[ 'gradient', 0.010850987831259458 ],
				[ 'bias', 0.010850987831259458 ],
				[ 'littl', 0.010850987831259458 ]
			]),
			[CARD_ID_FOUR]: new Map([
				[ 'truth', 0.06995912034958966 ],
				[ 'ground', 0.0258606783429186 ],
				[ 'land', 0.023203807090028103 ],
				[ 'true', 0.019404528064420567 ],
				[ 'you\'v', 0.019102936661019646 ],
				[ 'ever', 0.01784862108592967 ],
				[ 'it\'', 0.015957482682883203 ],
				[ 'modern', 0.013984777848439428 ],
				[ 'not', 0.013783288576292418 ],
				[ 'process', 0.013082872479078921 ],
				[ 'motion', 0.0129303391714593 ],
				[ 'subject', 0.0129303391714593 ],
				[ 'incorpor', 0.01218220302410421 ],
				[ 'learn', 0.011661437900260975 ],
				[ 'inconveni', 0.011127764347124085 ],
				[ 'asymptot', 0.011127764347124085 ],
				[ 'later', 0.011127764347124085 ],
				[ 'disconfirm', 0.010726885367300052 ],
				[ 'post', 0.010726885367300052 ],
				[ 'spectrum', 0.010726885367300052 ],
				[ 'outsid', 0.010726885367300052 ],
				[ 'directli', 0.010726885367300052 ],
				[ 'hill', 0.010379628199768993 ],
				[ 'longer', 0.010379628199768993 ],
				[ 'affect', 0.010073325670143957 ]
			]),
			[CARD_ID_FIVE]: new Map([
				[ 'site', 0.07197888805445676 ],
				[ 'stuff', 0.07197888805445676 ],
				[ 'quot', 0.06458392973391155 ],
				[ 'hill', 0.057779930312047395 ],
				[ 'climb', 0.054549596545112176 ],
				[ 'https://www.wikipedia.org/blammo', 0.03892429834482307 ],
				[ 'boundaries/edg', 0.03892429834482307 ],
				[ 'impor', 0.03892429834482307 ],
				[ 'komoroske.com/sudoku', 0.03892429834482307 ],
				[ 'washingtonpost.com', 0.03892429834482307 ],
				[ 'same', 0.03683363264370367 ],
				[ 'realli', 0.0309722774328287 ],
				[ 'here', 0.0309722774328287 ],
				[ 'e.g', 0.025375742400775475 ],
				[ 'interest', 0.024839331011252123 ],
				[ 'think', 0.024628693502097464 ],
				[ 'about', 0.02444659697871406 ],
				[ 'great', 0.022628904923342276 ],
				[ 'card', 0.019822164416852434 ],
				[ 'lot', 0.019085436708651544 ],
				[ 'know', 0.019085436708651544 ],
				[ 'anoth', 0.0165505869977863 ],
				[ 'detail', 0.016387923042967028 ],
				[ 'import', 0.015203533779209607 ],
				[ 'it\'', 0.01480499782245275 ]
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
				[ 'five', 2.1490259115174224 ],
				[ 'three', 2.0863091772745204 ],
				[ 'two', 0 ],
				[ 'four', 0 ]
			]),
			[CARD_ID_TWO]: new Map([
				[ 'three', 1.0236340301326285 ],
				[ 'one', 0 ],
				[ 'four', 0 ],
				[ 'five', 0 ]
			]),
			[CARD_ID_THREE]: new Map([
				[ 'one', 2.0863091772745204 ],
				[ 'five', 2.0640693493476134 ],
				[ 'four', 1.0898284623536398 ],
				[ 'two', 1.0236340301326285 ]
			]),
			[CARD_ID_FOUR]: new Map([
				[ 'five', 2.098922039017152 ],
				[ 'three', 1.0898284623536398 ],
				[ 'one', 0 ],
				[ 'two', 0 ]
			]),
			[CARD_ID_FIVE]: new Map([
				[ 'one', 2.1490259115174224 ],
				[ 'four', 2.098922039017152 ],
				[ 'three', 2.0640693493476134 ],
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

	it('destemmed word map', async () => {
		const card = baseCards()[CARD_ID_TWO];
		let wordMap = destemmedWordMap(card);
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

});

describe('PreparedQuery', () => {
	it('Basic query parsing single word', async () => {
		const query = new PreparedQuery('foo');
		const expectedQueryProperties = {
			'title': [
				[
					[
						'foo'
					],
					1,
					true
				]
			],
			'body': [
				[
					[
						'foo'
					],
					0.5,
					true
				]
			],
			'subtitle': [
				[
					[
						'foo'
					],
					0.75,
					true
				]
			],
			'references_info_inbound': [
				[
					[
						'foo'
					],
					0.95,
					true
				]
			]
		};
		assert.deepStrictEqual(query.text, expectedQueryProperties);
		assert.deepStrictEqual(query.filters, []);
	});

	it('Basic query parsing two words', async () => {
		const query = new PreparedQuery('foo bar');
		const expectedQueryProperties = {
			'title': [
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
			],
			'body': [
				[
					[
						'foo bar'
					],
					0.5,
					true
				],
				[
					[
						'foo',
						'bar'
					],
					0.25,
					true
				],
				[
					[
						'foo'
					],
					0.029820078419978902,
					false
				],
				[
					[
						'bar'
					],
					0.029820078419978902,
					false
				]
			],
			'subtitle': [
				[
					[
						'foo bar'
					],
					0.75,
					true
				],
				[
					[
						'foo',
						'bar'
					],
					0.375,
					true
				],
				[
					[
						'foo'
					],
					0.044730117629968355,
					false
				],
				[
					[
						'bar'
					],
					0.044730117629968355,
					false
				]
			],
			'references_info_inbound': [
				[
					[
						'foo bar'
					],
					0.95,
					true
				],
				[
					[
						'foo',
						'bar'
					],
					0.475,
					true
				],
				[
					[
						'foo'
					],
					0.056658148997959915,
					false
				],
				[
					[
						'bar'
					],
					0.056658148997959915,
					false
				]
			]
		};
		assert.deepStrictEqual(query.text, expectedQueryProperties);
		assert.deepStrictEqual(query.filters, []);
	});

	it('Basic query parsing two words stemming', async () => {
		const query = new PreparedQuery('you\'re crystallizing');
		const expectedQueryProperties = {
			'title': [
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
			],
			'body': [
				[
					[
						'you\'r crystal'
					],
					0.5,
					true
				],
				[
					[
						'you\'r',
						'crystal'
					],
					0.25,
					true
				],
				[
					[
						'you\'r'
					],
					0.04368562527100118,
					false
				],
				[
					[
						'crystal'
					],
					0.05281862750089105,
					false
				]
			],
			'subtitle': [
				[
					[
						'you\'r crystal'
					],
					0.75,
					true
				],
				[
					[
						'you\'r',
						'crystal'
					],
					0.375,
					true
				],
				[
					[
						'you\'r'
					],
					0.06552843790650177,
					false
				],
				[
					[
						'crystal'
					],
					0.07922794125133657,
					false
				]
			],
			'references_info_inbound': [
				[
					[
						'you\'r crystal'
					],
					0.95,
					true
				],
				[
					[
						'you\'r',
						'crystal'
					],
					0.475,
					true
				],
				[
					[
						'you\'r'
					],
					0.08300268801490224,
					false
				],
				[
					[
						'crystal'
					],
					0.10035539225169299,
					false
				]
			]
		};
		assert.deepStrictEqual(query.text, expectedQueryProperties);
		assert.deepStrictEqual(query.filters, []);
	});

	it('Basic query parsing one word one filter', async () => {
		const query = new PreparedQuery('crystallizing filter:has-links');
		const expectedQueryFilters = ['has-links'];
		const expectedQueryText = {
			'title': [
				[
					[
						'crystal'
					],
					1,
					true
				]
			],
			'body': [
				[
					[
						'crystal'
					],
					0.5,
					true
				]
			],
			'subtitle': [
				[
					[
						'crystal'
					],
					0.75,
					true
				]
			],
			'references_info_inbound': [
				[
					[
						'crystal'
					],
					0.95,
					true
				]
			]
		};
		assert.deepStrictEqual(query.text, expectedQueryText);
		assert.deepStrictEqual(query.filters, expectedQueryFilters);
	});

	it('Basic query parsing two words one filter', async () => {
		const query = new PreparedQuery('crystallizing blammo filter:has-links');
		const expectedQueryFilters = ['has-links'];
		const expectedQueryText = {
			'title': [
				[
					[
						'crystal blammo'
					],
					1,
					true
				],
				[
					[
						'crystal',
						'blammo'
					],
					0.5,
					true
				],
				[
					[
						'crystal'
					],
					0.1056372550017821,
					false
				],
				[
					[
						'blammo'
					],
					0.09726890629795545,
					false
				]
			],
			'body': [
				[
					[
						'crystal blammo'
					],
					0.5,
					true
				],
				[
					[
						'crystal',
						'blammo'
					],
					0.25,
					true
				],
				[
					[
						'crystal'
					],
					0.05281862750089105,
					false
				],
				[
					[
						'blammo'
					],
					0.04863445314897773,
					false
				]
			],
			'subtitle': [
				[
					[
						'crystal blammo'
					],
					0.75,
					true
				],
				[
					[
						'crystal',
						'blammo'
					],
					0.375,
					true
				],
				[
					[
						'crystal'
					],
					0.07922794125133657,
					false
				],
				[
					[
						'blammo'
					],
					0.07295167972346658,
					false
				]
			],
			'references_info_inbound': [
				[
					[
						'crystal blammo'
					],
					0.95,
					true
				],
				[
					[
						'crystal',
						'blammo'
					],
					0.475,
					true
				],
				[
					[
						'crystal'
					],
					0.10035539225169299,
					false
				],
				[
					[
						'blammo'
					],
					0.09240546098305767,
					false
				]
			]
		};
		assert.deepStrictEqual(query.text, expectedQueryText);
		assert.deepStrictEqual(query.filters, expectedQueryFilters);
	});

	it('Basic query parsing two words one filter in between', async () => {
		const query = new PreparedQuery('crystallizing filter:has-links blammo');
		const expectedQueryFilters = ['has-links'];
		const expectedQueryText = {
			'title': [
				[
					[
						'crystal blammo'
					],
					1,
					true
				],
				[
					[
						'crystal',
						'blammo'
					],
					0.5,
					true
				],
				[
					[
						'crystal'
					],
					0.1056372550017821,
					false
				],
				[
					[
						'blammo'
					],
					0.09726890629795545,
					false
				]
			],
			'body': [
				[
					[
						'crystal blammo'
					],
					0.5,
					true
				],
				[
					[
						'crystal',
						'blammo'
					],
					0.25,
					true
				],
				[
					[
						'crystal'
					],
					0.05281862750089105,
					false
				],
				[
					[
						'blammo'
					],
					0.04863445314897773,
					false
				]
			],
			'subtitle': [
				[
					[
						'crystal blammo'
					],
					0.75,
					true
				],
				[
					[
						'crystal',
						'blammo'
					],
					0.375,
					true
				],
				[
					[
						'crystal'
					],
					0.07922794125133657,
					false
				],
				[
					[
						'blammo'
					],
					0.07295167972346658,
					false
				]
			],
			'references_info_inbound': [
				[
					[
						'crystal blammo'
					],
					0.95,
					true
				],
				[
					[
						'crystal',
						'blammo'
					],
					0.475,
					true
				],
				[
					[
						'crystal'
					],
					0.10035539225169299,
					false
				],
				[
					[
						'blammo'
					],
					0.09240546098305767,
					false
				]
			]
		};
		assert.deepStrictEqual(query.text, expectedQueryText);
		assert.deepStrictEqual(query.filters, expectedQueryFilters);
	});

	it('Basic query parsing one hyphenated word one normal word', async () => {
		const query = new PreparedQuery('hill-climbing blammo');
		const expectedQueryFilters = [];
		const expectedQueryText = {
			'title': [
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
				]
			],
			'body': [
				[
					[
						'hill climb blammo'
					],
					0.5,
					true
				],
				[
					[
						'hill',
						'climb',
						'blammo'
					],
					0.25,
					true
				],
				[
					[
						'hill'
					],
					0.03762874945799765,
					false
				],
				[
					[
						'climb'
					],
					0.04368562527100118,
					false
				],
				[
					[
						'blammo'
					],
					0.04863445314897773,
					false
				]
			],
			'subtitle': [
				[
					[
						'hill climb blammo'
					],
					0.75,
					true
				],
				[
					[
						'hill',
						'climb',
						'blammo'
					],
					0.375,
					true
				],
				[
					[
						'hill'
					],
					0.05644312418699647,
					false
				],
				[
					[
						'climb'
					],
					0.06552843790650177,
					false
				],
				[
					[
						'blammo'
					],
					0.07295167972346658,
					false
				]
			],
			'references_info_inbound': [
				[
					[
						'hill climb blammo'
					],
					0.95,
					true
				],
				[
					[
						'hill',
						'climb',
						'blammo'
					],
					0.475,
					true
				],
				[
					[
						'hill'
					],
					0.07149462397019553,
					false
				],
				[
					[
						'climb'
					],
					0.08300268801490224,
					false
				],
				[
					[
						'blammo'
					],
					0.09240546098305767,
					false
				]
			]
		};
		assert.deepStrictEqual(query.text, expectedQueryText);
		assert.deepStrictEqual(query.filters, expectedQueryFilters);
	});

	it('query matching two words hyphenated all match', async () => {
		const query = new PreparedQuery('hill-climbing blammo');
		const card = baseCards()[CARD_ID_FIVE];
		const result = query.cardScore(card);
		const expectedResult = [ 0.12994882787797657, true ];
		assert.deepStrictEqual(result, expectedResult);
	});

	it('query matching partial match', async () => {
		const query = new PreparedQuery('hill-climbing slammo');
		const card = baseCards()[CARD_ID_FIVE];
		const result = query.cardScore(card);
		const expectedResult = [ 0.08131437472899883, false ];
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