type TagEventDetail = {
    tag : string,
    subtle : boolean,
};

export type TagTappedEvent = CustomEvent<TagEventDetail>;

export const TAG_TAPPED_EVENT_NAME = 'tag-tapped';

export const makeTagTappedEvent = (tagName : string, subtle? : boolean) : TagTappedEvent => {
    return new CustomEvent(TAG_TAPPED_EVENT_NAME, {composed: true, detail: {tag: tagName, subtle}});
}