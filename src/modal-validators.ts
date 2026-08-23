//Named, serializable validators for the modal seam's input requests.
//
//WHY NAMES AND NOT FUNCTIONS. The request is a plain object parked in the Redux
//store, and a function in the store is not serializable: it does not survive a
//JSON round trip, it would throw DataCloneError if MODAL_OPEN ever entered
//FORWARDED_ACTION_TYPES and got structured-cloned to the corpus worker, and it
//cannot be inspected by a devtool. An earlier draft of this seam put the
//function in the request anyway and justified it with a claim about
//test/reactive-state that turned out to be false — that test asserts @state()
//decorators via the TypeScript AST and has nothing to do with the store. There
//is no serializability test in this repo today. The constraint is real
//regardless of whether something enforces it.
//
//Both halves of the seam resolve names through this one table, so the fallback
//and the eventual dialog cannot drift: the fallback validates on submit, and
//the dialog will validate as you type, from the same function.

import {
	legalUid
} from './util.js';

import {
	normalizeSlug
} from '../shared/util.js';

import {
	srcSeemsValid
} from './images.js';

//Returns a sentence-case complaint, or null when the value is fine.
export type ModalValidator = (value : string) => string | null;

export type ModalValidatorName = 'non-empty' | 'uid' | 'slug' | 'image-src';

const VALIDATORS : {[name in ModalValidatorName] : ModalValidator} = {
	'non-empty': value => value.trim() ? null : 'That can\'t be empty.',
	//permissions-view.ts and card-editor.ts both alert() a refusal today; the
	//dialog shows it beside the field instead.
	'uid': value => legalUid(value) ? null : 'That doesn\'t look like a user ID.',
	'slug': value => normalizeSlug(value) === value.toLowerCase() && value.trim() ? null : 'A slug can only use letters, numbers and dashes.',
	'image-src': value => srcSeemsValid(value) ? null : 'An image address has to start with http:// or https://.',
};

export const validatorNamed = (name : ModalValidatorName) : ModalValidator => VALIDATORS[name];
