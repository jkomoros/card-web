
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

//date may be a firestore timestamp or a date object.
export const prettyTime = (date) => {
	if (!date) return "";
	if (typeof date.toDate == 'function') date = date.toDate();
	return date.toDateString();
}