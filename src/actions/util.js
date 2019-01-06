
const randomCharSet = "abcdef0123456789"

export const randomString = (length, charSet) => {
  if (!charSet) {
    charSet = randomCharSet;
  }
  let text = "";
  for (let i = 0; i < length; i++) {
    text += randomCharSet.charAt(Math.floor(Math.random() * randomCharSet.length));
  }
  return text;
}

export const arrayRemove = (arr, items) => {
	let itemsToRemove = new Map();
	for (let item of Object.values(items)) {
		itemsToRemove.set(item, true);
	}
	let result = [];
	for (let val of Object.values(arr)) {
		if (itemsToRemove.has(val)) continue;
		result.push(val);
	}
	return result;
}

export const arrayUnion = (arr, items) => {
	let result = [];
	let seenItems = new Map();
	for (let val of Object.values(arr)) {
		seenItems.set(val, true);
		result.push(val);
	}
	for (let val of Object.values(items)) {
		if (seenItems.has(val)) continue;
		result.push(val);
	}	
	return result;
}

//items is an array
export const setRemove = (obj, items) => {
	let result = {};
	for (let key of Object.keys(obj)) {
		result[key] = true;
	}
	for (let item of items) {
		delete result[item];
	}
	return result;
}

//items is an array
export const setUnion = (obj, items) => {
	let result = {};
	for (let key of Object.keys(obj)) {
		result[key] = true;
	}
	for (let item of items) {
		result[item] = true;
	}
	return result;
}

const unionSet = (...sets) => {
	let result = {};
	for (let set of sets) {
		for (let key of Object.keys(set)) {
			result[key] = true;
		}
	}
	return result;
}

export const intersectionSet = (...sets) => {
	let union = unionSet(...sets);
	let result = {};
	for (let key of Object.keys(union)) {
		//Only include keys that are in every set.
		let doInclude = true;
		for (let set of sets) {
			if (!set[key]) {
				doInclude = false;
				break;
			}
		}
		if (doInclude) result[key] = true;
	}
	return result;
}

//date may be a firestore timestamp or a date object.
export const prettyTime = (date) => {
	if (!date) return "";
	if (typeof date.toDate == 'function') date = date.toDate();
	return date.toDateString();
}

export const killEvent = (e) => {
	if (e) {
		e.preventDefault();
	}
	return true;
}

export const isWhitespace = (s) => {
	return /^\s*$/.test(s)
}

//Items in the reads and stars collections are stored at a canonical id given
//a uid and card id.
export const idForPersonalCardInfo = (uid, cardId) => {
	return "" + uid + "+" + cardId;
}