type TagEventDetail = {
    tag : string,
    subtle : boolean,
};

export type TagEvent = CustomEvent<TagEventDetail>;

export const TAG_TAPPED_EVENT_NAME = 'tag-tapped';
//TODO: change to 'tag-added'
export const TAG_ADDED_EVENT_NAME = 'add-tag';
//TODO: change to 'tag-removed'
export const TAG_REMOVED_EVENT_NAME = 'remove-tag';

export const makeTagTappedEvent = (tagName : string, subtle? : boolean) : TagEvent => {
    return makeTagEvent(TAG_TAPPED_EVENT_NAME, tagName, subtle);
}

export const makeTagAddedEvent = (tagName : string) : TagEvent => {
    return makeTagEvent(TAG_ADDED_EVENT_NAME, tagName);
}

export const makeTagRemovedEvent = (tagName : string) : TagEvent => {
    return makeTagEvent(TAG_REMOVED_EVENT_NAME, tagName);
}

const makeTagEvent = (eventName : string, tagName : string, subtle? : boolean) : TagEvent => {
    return new CustomEvent(eventName, {composed: true, detail: {tag: tagName, subtle}});
}