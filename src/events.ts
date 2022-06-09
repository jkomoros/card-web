import {
    CardID
} from './types.js';

type TagEventDetail = {
    tag : string,
    subtle : boolean,
};

type CardHoveredEventDetail = {
    card : CardID;
    x : number;
    y : number;
}

type ThumbnailTappedDetail = {
    card : CardID;
    ctrl : boolean;
}

type UpdateRenderOffsetDetail = {
    value : number;
}

export type TagEvent = CustomEvent<TagEventDetail>;
export type NewTagEvent = CustomEvent<null>;
export type CardHoveredEvent = CustomEvent<CardHoveredEventDetail>;
export type ThumbnailTappedEvent = CustomEvent<ThumbnailTappedDetail>;
export type UpdateRenderOffsetEvent = CustomEvent<UpdateRenderOffsetDetail>;

export const TAG_TAPPED_EVENT_NAME = 'tag-tapped';
//TODO: change to 'tag-added'
export const TAG_ADDED_EVENT_NAME = 'add-tag';
//TODO: change to 'tag-removed'
export const TAG_REMOVED_EVENT_NAME = 'remove-tag';
//TODO: change to 'tag-new'
export const TAG_NEW_EVENT_NAME = 'new-tag';
export const CARD_HOVERED_EVENT_NAME = 'card-hovered';
export const THUMBNAIL_TAPPED_EVENT_NAME = 'thumbnail-tapped';
export const UPDATE_RENDER_OFFSET_EVENT_NAME = 'update-render-offset';

export const makeTagTappedEvent = (tagName : string, subtle? : boolean) : TagEvent => {
    return makeTagEvent(TAG_TAPPED_EVENT_NAME, tagName, subtle);
}

export const makeTagAddedEvent = (tagName : string) : TagEvent => {
    return makeTagEvent(TAG_ADDED_EVENT_NAME, tagName);
}

export const makeTagRemovedEvent = (tagName : string) : TagEvent => {
    return makeTagEvent(TAG_REMOVED_EVENT_NAME, tagName);
}

export const makeTagNewEvent = () : NewTagEvent => {
    return new CustomEvent(TAG_NEW_EVENT_NAME, {composed : true, detail: null})
}

const makeTagEvent = (eventName : string, tagName : string, subtle : boolean = false) : TagEvent => {
    return new CustomEvent(eventName, {composed: true, detail: {tag: tagName, subtle}});
}

export const makeCardHoveredEvent = (card : CardID, x : number, y : number) : CardHoveredEvent => {
    return new CustomEvent(CARD_HOVERED_EVENT_NAME, {composed : true, detail: {card, x, y}});
}

export const makeThumbnailTappedEvent = (card : CardID, ctrl : boolean) : ThumbnailTappedEvent => {
    return new CustomEvent(THUMBNAIL_TAPPED_EVENT_NAME, {composed : true, detail: {card, ctrl}});
}

export const makeUpdateRenderOffsetEvent = (value : number) : UpdateRenderOffsetEvent => {
    return new CustomEvent(UPDATE_RENDER_OFFSET_EVENT_NAME, {composed : true, detail : {value}});
};