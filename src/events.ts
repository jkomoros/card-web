type TagEventDetail = {
    tag : string,
    subtle : boolean,
};

export type TagEvent = CustomEvent<TagEventDetail>;

export const TAG_TAPPED_EVENT_NAME = 'tag-tapped';

export const makeTagTappedEvent = (tagName : string, subtle? : boolean) : TagEvent => {
    return makeTagEvent(TAG_TAPPED_EVENT_NAME, tagName, subtle);
}

const makeTagEvent = (eventName : string, tagName : string, subtle? : boolean) : TagEvent => {
    return new CustomEvent(eventName, {composed: true, detail: {tag: tagName, subtle}});
}