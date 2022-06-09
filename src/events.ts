//Avoid importing TagChip and just enumerate the properties we know others want
interface TagChipElementInterface extends HTMLElement {
    subtle : boolean,
    tagName : string
}

type TagEventDetail = {
    tag : string,
    ele : TagChipElementInterface,
};

export type TagTappedEvent = CustomEvent<TagEventDetail>;

export const TAG_TAPPED_EVENT_NAME = 'tag-tapped';

export const makeTagTappedEvent = (source : TagChipElementInterface) : TagTappedEvent => {
    return new CustomEvent(TAG_TAPPED_EVENT_NAME, {composed: true, detail: {tag: source.tagName, ele: source}});
}