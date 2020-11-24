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
	FingerprintGenerator,
	PreparedQuery,
	TESTING,
	prettyFingerprint,
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
				[ 'complex kei', 0.03968381673060781 ],
				[ 'kei concept', 0.03968381673060781 ],
				[ 'concept understand', 0.03968381673060781 ],
				[ 'understand uncertainti', 0.03968381673060781 ],
				[ 'card thi', 0.03766867581757071 ],
				[ 'lot', 0.03693955491997073 ],
				[ 'down', 0.03649477154946643 ],
				[ 'understand', 0.02942619441137343 ],
				[ 'thi', 0.028367405034204447 ],
				[ 'them', 0.015134534245328688 ],
				[ 'complex', 0.010475291461213261 ]
			]),
			[CARD_ID_TWO]: new Map([
				[ 'cynefin', 0.03812454134649384 ],
				[ 'model', 0.03665907126150592 ],
				[ 'terminolog', 0.02195487696336937 ],
				[ 'call', 0.0216673098074069 ],
				[ 'unknow', 0.01764653428108488 ],
				[ 'chaotic', 0.01764653428108488 ],
				[ 'cynefin model', 0.01728975556678813 ],
				[ 'complic', 0.01687878560680756 ],
				[ 'requir', 0.014112882533192267 ],
				[ 'cynefin\'', 0.013232056094557418 ],
				[ 'blammo', 0.013232056094557418 ],
				[ 'cynenfin', 0.013232056094557418 ],
				[ 'hard', 0.01265257722939748 ],
				[ 'divid', 0.012234371907273105 ],
				[ 'four', 0.012234371907273105 ],
				[ 'method', 0.012234371907273105 ],
				[ 'inscrut', 0.012234371907273105 ],
				[ 'i’v', 0.012234371907273105 ],
				[ 'cynfefin’', 0.012234371907273105 ],
				[ 'unknow hard', 0.01185506998302034 ],
				[ 'knowabl', 0.011526503711192087 ],
				[ 'unclear', 0.011526503711192087 ],
				[ 'intric', 0.010977438481684684 ],
				[ 'distinguish', 0.010977438481684684 ],
				[ 'special', 0.010528819523907773 ],
				[ 'dupe', 0.009820951327826753 ],
				[ 'diagnos', 0.00953113533662346 ],
				[ 'simpl', 0.009271886098319351 ],
				[ 'past', 0.009271886098319351 ],
				[ 'ambigu', 0.009271886098319351 ],
				[ 'shift', 0.009271886098319351 ],
				[ 'trivial', 0.00903736663566652 ],
				[ 'consist', 0.00903736663566652 ],
				[ 'differ', 0.008761076897823338 ],
				[ 'next', 0.008626314697147471 ]
			]),
			[CARD_ID_THREE]: new Map([
				[ 'let', 0.029080117202947398 ],
				[ 'go', 0.02146621705568041 ],
				[ 'let go', 0.01918055023189969 ],
				[ 'detail', 0.016572057009741938 ],
				[ 'truth', 0.016408950980872857 ],
				[ 'attent', 0.013120550003872945 ],
				[ 'complex', 0.012770439590355493 ],
				[ 'becom', 0.012136914557146947 ],
				[ 'unnatur', 0.012131273267605073 ],
				[ 'cosmic', 0.012131273267605073 ],
				[ 'calm', 0.012131273267605073 ],
				[ 'uncomfort', 0.012131273267605073 ],
				[ 'have let', 0.012131273267605073 ],
				[ 'onli', 0.01149851775697821 ],
				[ 'pai', 0.011429370252951702 ],
				[ 'type', 0.011269881357008751 ],
				[ 'go detail', 0.011141996531337201 ],
				[ 'latter', 0.010884931977625542 ],
				[ 'embrac', 0.01044009351668383 ],
				[ 'scari', 0.01044009351668383 ],
				[ 'import', 0.010249573334298611 ],
				[ 'correctli', 0.010063987956961284 ],
				[ 'solut', 0.009894528546976113 ],
				[ 'diagnos', 0.009450816780415958 ],
				[ 'illus', 0.009193752226704299 ],
				[ 'gradient', 0.008961209051658092 ],
				[ 'bias', 0.008961209051658092 ],
				[ 'littl', 0.008961209051658092 ],
				[ 'evid', 0.008553621033969262 ],
				[ 'ever', 0.008372808206040042 ],
				[ 'broader', 0.008204475490436429 ],
				[ 'problem space', 0.00816602480446695 ],
				[ 'certain', 0.008047010751109217 ],
				[ 'awai', 0.007899095365028603 ],
				[ 'they\'r', 0.0077596370294947155 ]
			]),
			[CARD_ID_FOUR]: new Map([
				[ 'truth', 0.057411170016616574 ],
				[ 'ground', 0.02122227657625261 ],
				[ 'land', 0.019041944884691367 ],
				[ 'true', 0.015924109025838993 ],
				[ 'you\'v', 0.01567661141223725 ],
				[ 'ever', 0.01464727135798651 ],
				[ 'it\'', 0.013095329769245675 ],
				[ 'modern', 0.011476451600439235 ],
				[ 'there not', 0.011476451600439235 ],
				[ 'ground truth', 0.011476451600439235 ],
				[ 'truth as', 0.011476451600439235 ],
				[ 'land at', 0.011476451600439235 ],
				[ 'not', 0.01131110168177314 ],
				[ 'process', 0.010736313041799408 ],
				[ 'motion', 0.010611138288126305 ],
				[ 'subject', 0.010611138288126305 ],
				[ 'not on', 0.010611138288126305 ],
				[ 'at it', 0.010611138288126305 ],
				[ 'incorpor', 0.009997188722483553 ],
				[ 'true for', 0.009997188722483553 ],
				[ 'learn', 0.009569828645423011 ],
				[ 'inconveni', 0.009131875410170624 ],
				[ 'asymptot', 0.009131875410170624 ],
				[ 'later', 0.009131875410170624 ],
				[ 'disconfirm', 0.008802898556948937 ],
				[ 'post', 0.008802898556948937 ],
				[ 'spectrum', 0.008802898556948937 ],
				[ 'outsid', 0.008802898556948937 ],
				[ 'directli', 0.008802898556948937 ],
				[ 'hill', 0.00851792584452787 ],
				[ 'longer', 0.00851792584452787 ],
				[ 'affect', 0.008266562097857692 ],
				[ 'for you', 0.008266562097857692 ],
				[ 'climb', 0.008041709564390001 ],
				[ 'total', 0.008041709564390001 ]
			]),
			[CARD_ID_FIVE]: new Map([
				[ 'site', 0.06445870572040904 ],
				[ 'stuff', 0.06445870572040904 ],
				[ 'quot', 0.057836354985592434 ],
				[ 'hill', 0.05174322117496782 ],
				[ 'climb', 0.0488503849657721 ],
				[ 'https://www.wikipedia.org/blammo', 0.03485758060730424 ],
				[ 'impor', 0.03485758060730424 ],
				[ 'komoroske.com/sudoku', 0.03485758060730424 ],
				[ 'washingtonpost.com', 0.03485758060730424 ],
				[ 'same', 0.03298534266600329 ],
				[ 'hill climb', 0.031230147044822236 ],
				[ 'boundari', 0.028918177492796217 ],
				[ 'realli', 0.027736367850294357 ],
				[ 'here', 0.027736367850294357 ],
				[ 'edg', 0.026737162034912068 ],
				[ 'e.g', 0.022724545433530276 ],
				[ 'interest', 0.0222441770250019 ],
				[ 'think', 0.022055546419788775 ],
				[ 'about', 0.021892474906311098 ],
				[ 'great', 0.02026469097612741 ],
				[ 'card ha', 0.018361168935057345 ],
				[ 'lot interest', 0.018361168935057345 ],
				[ 'interest detail', 0.018361168935057345 ],
				[ 'detail https://www.wikipedia.org/blammo', 0.018361168935057345 ],
				[ 'https://www.wikipedia.org/blammo great', 0.018361168935057345 ],
				[ 'great site', 0.018361168935057345 ],
				[ 'site it\'', 0.018361168935057345 ],
				[ 'import think', 0.018361168935057345 ],
				[ 'think stuff', 0.018361168935057345 ],
				[ 'stuff e.g', 0.018361168935057345 ],
				[ 'e.g other', 0.018361168935057345 ],
				[ 'other stuff', 0.018361168935057345 ],
				[ 'stuff hill', 0.018361168935057345 ],
				[ 'climb same', 0.018361168935057345 ],
				[ 'as hill', 0.018361168935057345 ]
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
				[ 'three', 2.0836616243353276 ],
				[ 'two', 0 ],
				[ 'four', 0 ],
				[ 'five', 0 ]
			]),
			[CARD_ID_TWO]: new Map([
				[ 'three', 1.0189819521170393 ],
				[ 'one', 0 ],
				[ 'four', 0 ],
				[ 'five', 0 ]
			]),
			[CARD_ID_THREE]: new Map([
				[ 'four', 2.096840200561516 ],
				[ 'one', 2.0836616243353276 ],
				[ 'two', 1.0189819521170393 ],
				[ 'five', 0 ]
			]),
			[CARD_ID_FOUR]: new Map([
				[ 'five', 2.1171532415496577 ],
				[ 'three', 2.096840200561516 ],
				[ 'one', 0 ],
				[ 'two', 0 ]
			]),
			[CARD_ID_FIVE]: new Map([
				[ 'four', 2.1171532415496577 ],
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

	it('destemmed word map', async () => {
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

	it('pretty fingerprint', async () => {
		const cards = baseCards();
		const generator = new FingerprintGenerator(cards);
		const fingerprint = generator.fingerprintForCardID(CARD_ID_TWO);
		const pretty = prettyFingerprint(fingerprint, cards[CARD_ID_TWO]);
		const expectedPretty = 'Cynefin Model Terminology Calls Unknowably Chaotic Complicated Require Cynefin\'s Blammo Cynenfin Hard Divides Four Methods Inscrutable I’ve Cynfefin’s Knowably Unclear Intricate Distinguishing Special Dupe Diagnosing Simple Past Ambiguous Shifted Trivial Consistently Different Next';
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
		assert.deepStrictEqual(query.filters, []);
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
		assert.deepStrictEqual(query.filters, []);
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
		assert.deepStrictEqual(query.filters, []);
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
		assert.deepStrictEqual(query.filters, []);
	});

	it('Basic query parsing one word one filter', async () => {
		const query = new PreparedQuery('crystallizing filter:has-links');
		const expectedQueryFilters = ['has-links'];
		const expectedQueryText = expandExpectedQueryProperties(
			[
				[
					[
						'crystal'
					],
					1,
					true
				]
			],
		);
		assert.deepStrictEqual(query.text, expectedQueryText);
		assert.deepStrictEqual(query.filters, expectedQueryFilters);
	});

	it('Basic query parsing two words one filter', async () => {
		const query = new PreparedQuery('crystallizing blammo filter:has-links');
		const expectedQueryFilters = ['has-links'];
		const expectedQueryText = expandExpectedQueryProperties(
			[
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
			]
		);
		assert.deepStrictEqual(query.text, expectedQueryText);
		assert.deepStrictEqual(query.filters, expectedQueryFilters);
	});

	it('Basic query parsing two words one filter in between', async () => {
		const query = new PreparedQuery('crystallizing filter:has-links blammo');
		const expectedQueryFilters = ['has-links'];
		const expectedQueryText = expandExpectedQueryProperties(
			[
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
			]
		);
		assert.deepStrictEqual(query.text, expectedQueryText);
		assert.deepStrictEqual(query.filters, expectedQueryFilters);
	});

	it('Basic query parsing one hyphenated word one normal word', async () => {
		const query = new PreparedQuery('hill-climbing blammo');
		const expectedQueryFilters = [];
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
		assert.deepStrictEqual(query.filters, expectedQueryFilters);
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