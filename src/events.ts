import {
    CardFieldTypeEditable,
    CardID,
    ComposedCommentMessage,
    ComposedCommentThread
} from './types.js';

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

const makeTagEvent = (eventName : string, tagName : string, subtle : boolean = false) : TagEvent => {
    return new CustomEvent(eventName, {composed: true, detail: {tag: tagName, subtle}});
}

export type NewTagEvent = CustomEvent<null>;

//TODO: change to 'tag-new'
export const TAG_NEW_EVENT_NAME = 'new-tag';

export const makeTagNewEvent = () : NewTagEvent => {
    return new CustomEvent(TAG_NEW_EVENT_NAME, {composed : true, detail: null})
}

export type ShowNeedSigninEvent = CustomEvent<null>;

export const SHOW_NEED_SIGNIN_EVENT_NAME = 'show-need-signin';

export const makeShowNeedSigninEvent = () : ShowNeedSigninEvent => {
    return new CustomEvent(SHOW_NEED_SIGNIN_EVENT_NAME, {composed : true, detail: null})
}

type CardHoveredEventDetail = {
    card : CardID;
    x : number;
    y : number;
}

export type CardHoveredEvent = CustomEvent<CardHoveredEventDetail>;

export const CARD_HOVERED_EVENT_NAME = 'card-hovered';

export const makeCardHoveredEvent = (card : CardID, x : number, y : number) : CardHoveredEvent => {
    return new CustomEvent(CARD_HOVERED_EVENT_NAME, {composed : true, detail: {card, x, y}});
}

type ThumbnailTappedDetail = {
    card : CardID;
    ctrl : boolean;
}

export type ThumbnailTappedEvent = CustomEvent<ThumbnailTappedDetail>;

export const THUMBNAIL_TAPPED_EVENT_NAME = 'thumbnail-tapped';

export const makeThumbnailTappedEvent = (card : CardID, ctrl : boolean) : ThumbnailTappedEvent => {
    return new CustomEvent(THUMBNAIL_TAPPED_EVENT_NAME, {composed : true, detail: {card, ctrl}});
}

type UpdateRenderOffsetDetail = {
    value : number;
}

export type UpdateRenderOffsetEvent = CustomEvent<UpdateRenderOffsetDetail>;

export const UPDATE_RENDER_OFFSET_EVENT_NAME = 'update-render-offset';

export const makeUpdateRenderOffsetEvent = (value : number) : UpdateRenderOffsetEvent => {
    return new CustomEvent(UPDATE_RENDER_OFFSET_EVENT_NAME, {composed : true, detail : {value}});
};

type DialogShouldCloseDetail = {
    cancelled : boolean;
}

export type DialogShouldCloseEvent = CustomEvent<DialogShouldCloseDetail>;

export const DIALOG_SHOULD_CLOSE_EVENT_NAME = 'dialog-should-close';

export const makeDialogShouldCloseEvent = (cancelled : boolean = false) : DialogShouldCloseEvent => {
    return new CustomEvent(DIALOG_SHOULD_CLOSE_EVENT_NAME, {composed : true, detail: {cancelled}});
}

type CommentMessageDetail = {
    message : ComposedCommentMessage;
}

export type CommmentMessageEvent = CustomEvent<CommentMessageDetail>;

//TODO: rename to message-edit?
//TODO: rename to message-delete?
export const COMMENT_EDIT_MESSAGE_NAME = 'edit-message';
export const COMMENT_DELETE_MESSAGE_NAME = 'delete-message';

export const makeCommentEditMessageEvent = (message : ComposedCommentMessage) : CommmentMessageEvent => {
    return new CustomEvent(COMMENT_EDIT_MESSAGE_NAME, {composed : true, detail: {message}});
}

export const makeCommentDeleteMessageEvent = (message : ComposedCommentMessage) : CommmentMessageEvent => {
    return new CustomEvent(COMMENT_DELETE_MESSAGE_NAME, {composed : true, detail: {message}});
}

type CommentThreadDetail = {
    thread : ComposedCommentThread;
}

export type CommmentThreadEvent = CustomEvent<CommentThreadDetail>;

//TODO: name to thread-resolve?
export const COMMENT_RESOLVE_THREAD_NAME = 'resolve-thread';
//TODO: name to thread-add-message?
export const COMMENT_ADD_MESSAGE_TO_THREAD_NAME = 'add-message';

export const makeCommentResolveThreadEvent = (thread : ComposedCommentThread) : CommmentThreadEvent => {
    return new CustomEvent(COMMENT_RESOLVE_THREAD_NAME, {composed : true, detail: {thread}});
}

export const makeCommentAddMessageToThreadEvent = (thread : ComposedCommentThread) : CommmentThreadEvent => {
    return new CustomEvent(COMMENT_ADD_MESSAGE_TO_THREAD_NAME, {composed : true, detail: {thread}});
}

type FilterModifiedDetail = {
    value : string,
    index : number
}

export type FilterModifiedEvent = CustomEvent<FilterModifiedDetail>;

export const FILTER_MODIFIED_EVENT_NAME = 'filter-modified';
export const FILTER_REMOVED_EVENT_NAME = 'filter-removed';
//TODO: rename this to filter-modified-complex, or just get rid of it and do filter-modified?
export const FILTER_MODIFIED_COMPLEX_EVENT_NAME = 'change-complex';

export const makeFilterModifiedEvent = (value : string, index : number = 0) : FilterModifiedEvent => {
    return new CustomEvent(COMMENT_ADD_MESSAGE_TO_THREAD_NAME, {composed : true, detail: {value, index}});
}

export const makeFilterRemovedEvent = (index : number) : FilterModifiedEvent => {
    return makeFilterModifiedEvent('', index);
}

export const makeFilterModifiedComplexEvent = (value : string) : FilterModifiedEvent => {
    return makeFilterModifiedEvent(value);
}

type CardSwipeDirection = 'left' | 'right';

type CardSwipedDetail = {
    direction : CardSwipeDirection
}

export type CardSwipedEvent = CustomEvent<CardSwipedDetail>;

export const CARD_SWIPED_EVENT_NAME = 'card-swiped';

export const makeCardSwipedEvent = (direction : CardSwipeDirection) : CardSwipedEvent => {
    return new CustomEvent(COMMENT_ADD_MESSAGE_TO_THREAD_NAME, {composed : true, detail: {direction}});
}

type DisabledCardHighlightClickedDetail = {
    card : CardID,
    alternate : boolean,
}

export type DisabledCardHighlightClickedEvent = CustomEvent<DisabledCardHighlightClickedDetail>;

export const DISABLED_CARD_HIGHLIGHT_CLICKED_EVENT_NAME = 'disabled-card-highlight-clicked';

export const makeDisabledCardHighlightClickedEvent = (card : CardID, alternate : boolean) : DisabledCardHighlightClickedEvent => {
    return new CustomEvent(COMMENT_ADD_MESSAGE_TO_THREAD_NAME, {composed : true, detail: {card, alternate}});
}

type EditabledCardFieldUpdatedDetail = {
    field : CardFieldTypeEditable,
    value : string,
}

export type EditabledCardFieldUpdatedEvent = CustomEvent<EditabledCardFieldUpdatedDetail>;
//TODO: rename to be consistent with type name?
export const EDITABLE_CARD_FIELD_UPDATED_EVENT_NAME = 'text-field-updated';

export const makeEditableCardFieldUpdatedEvent = (field : CardFieldTypeEditable, value : string) : EditabledCardFieldUpdatedEvent => {
    return new CustomEvent(COMMENT_ADD_MESSAGE_TO_THREAD_NAME, {composed : true, detail: {field, value}});
}