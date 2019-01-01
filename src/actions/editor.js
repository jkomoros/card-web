export const EDITING_START = 'EDITING_START';
export const EDITING_FINISH = 'EDITING_FINISH';
export const EDITING_TITLE_UPDATED = 'EDITING_TITLE_UPDATED';
export const EDITING_BODY_UPDATED = 'EDITING_BODY_UPDATED';
export const EDITING_SECTION_UPDATED = 'EDITING_SECTION_UPDATED';
export const EDITING_SLUG_ADDED = 'EDITING_SLUG_ADDED';
export const EDITING_NAME_UPDATED = 'EDITING_NAME_UPDATED';
export const EDITING_SUBSTANTIVE_UPDATED = 'EDITING_SUBSTANTIVE_UPDATED';
export const EDITING_FULL_BLEED_UPDATED = 'EDITING_FULL_BLEED_UPDATED';

import {
  userMayEdit
} from '../reducers/user.js';

import {
  cardSelector
} from '../reducers/data.js'

import {
  modifyCard
} from './data.js';

export const editingStart = () => (dispatch, getState) => {
  const state = getState();
  if (!userMayEdit(state)) {
    console.warn("This user is not allowed to edit!")
    return;
  }
  const card = cardSelector(state)
  if (!card || !card.id) {
    console.warn("There doesn't appear to be an active card.");
    return;
  }
  dispatch({type: EDITING_START, card: card});
}

export const editingCommit = () => (dispatch, getState) => {
  const state = getState();
  if (!userMayEdit(state)) {
    console.warn("This user isn't allowed to edit!");
    return;
  }
  const underlyingCard = cardSelector(state);
  if (!underlyingCard || !underlyingCard.id) {
    console.warn("That card isn't legal");
    return;
  }

  const updatedCard = state.editor.card;

  let update = {};

  if (updatedCard.title != underlyingCard.title) update.title = updatedCard.title;
  if (updatedCard.body != underlyingCard.body) update.body = updatedCard.body;
  if (updatedCard.section != underlyingCard.section) update.section = updatedCard.section;
  if (updatedCard.name != underlyingCard.section) update.name = updatedCard.name;
  if (updatedCard.full_bleed != underlyingCard.full_bleed) update.full_bleed = updatedCard.full_bleed;

  //modifyCard will fail if the update is a no-op.
  dispatch(modifyCard(underlyingCard, update, state.editor.substantive));

}

const normalizeLink = (a) => {
  //Modifies the element in place
  if (!a) return;
  let href = a.href;
  if (href.startsWith('http:')) return;
  if (href.startsWith('/')) return;
  a.setAttribute('card', href);
  a.href = "";
}

const normalizeBodyHTML = (html, fromContentEditable) => {

  //normalizeBodyHTML makes sure that the html is well formatted. It first
  //does basic string processing to clean it up, but then if
  //fromContentEditable is true does more invasive processing that includes
  //parsing the markup. If fromContentEditable is false, then we assume that
  //it's possible that the markup is currently not valid html (for example, it
  //ends with "<a hre").

  //normalizeBodyHTML should do processing on the HTML (that comes potentially
  //from contentEditable) to represent it in a sane, simple way that should
  //ideally not change the display of the content, just structure the markup
  //differently.

  //Ensure that after every block element we have a new line. Don't worry
  //about putting in extra; we'll remove them in the next step.
  html = html.split("</p>").join("</p>\n");
  html = html.split("<b>").join("<strong>");
  html = html.split("</b>").join("</strong>");
  html = html.split("<i>").join("<em>");
  html = html.split("</i>").join("</em>");

  //Remove any extra linke breaks (which we might have added)
  html = html.split("\n\n").join("\n");

  if (!fromContentEditable) return html;

  let section = document.createElement("section");
  section.innerHTML = html;

  section.querySelectorAll('a').forEach(normalizeLink);

  return section.innerHTML;
}

export const editingFinish = () => {
  return {type: EDITING_FINISH}
}

export const titleUpdated = (newTitle) => {
  return {
    type: EDITING_TITLE_UPDATED,
    title:newTitle,
  }
}

export const bodyUpdated = (newBody, fromContentEditable) => {
  return {
    type: EDITING_BODY_UPDATED,
    body: normalizeBodyHTML(newBody, fromContentEditable),
    fromContentEditable
  }
}

export const sectionUpdated = (newSection) => {
  return {
    type: EDITING_SECTION_UPDATED,
    section: newSection
  }
}

export const slugAdded = (newSlug) => {
  return {
    type: EDITING_SLUG_ADDED,
    slug: newSlug
  }
}

export const nameUpdated = (newName) => {
  return {
    type: EDITING_NAME_UPDATED,
    name: newName
  }
}

export const substantiveUpdated = (checked) => {
  return {
    type: EDITING_SUBSTANTIVE_UPDATED,
    checked,
  }
}

export const fullBleedUpdated = (fullBleed) => {
  return {
    type: EDITING_FULL_BLEED_UPDATED,
    fullBleed
  }
}
