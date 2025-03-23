let DOCUMENT : Document | null = typeof window !== 'undefined' && window.document ? window.document : null;

//overrideDocument can be used to inject a document to use for use in e.g.
//testing contexts. If  you don't call this then it will use window.document.
export const overrideDocument = (overrideDoc : Document) => {
	DOCUMENT = overrideDoc;
};

//DOCUMENT will be window.document or whatever was set via overrideDocument.
export const getDocument = (): Document | null => {
	return DOCUMENT;
};