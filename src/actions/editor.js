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
  if (updatedCard.section != underlyingCard.section) update.section = updatedCard.section;
  if (updatedCard.name != underlyingCard.section) update.name = updatedCard.name;
  if (updatedCard.full_bleed != underlyingCard.full_bleed) update.full_bleed = updatedCard.full_bleed;
  if (updatedCard.body != underlyingCard.body) {
    let normalizedBody;
    try {    
      normalizedBody = normalizeBodyHTML(updatedCard.body);
    } catch(err) {
      alert("Couldn't save: invalid HTML: " + err);
      return;
    }
    update.body = normalizedBody;
  }

  //modifyCard will fail if the update is a no-op.
  dispatch(modifyCard(underlyingCard, update, state.editor.substantive));

}

const replaceAsWithCardLinks = (body) => {
  //Replaces all a's with card-links.
  //TODO: consider modifying the actual nodes in place, which is more robust.;
  body = body.split("<a").join("<card-link");
  body = body.split("</a>").join("</card-link>");
  return body;
}

const replaceCardLinksWithAs = (body) => {
  //Inverse of replaceAwsWithCardLinks
  body = body.split("<card-link").join("<a");
  body = body.split("</card-link>").join("</a>");
  return body;
}

const hrefToCardAttribute = (cardLink) => {
  
  let href = cardLink.getAttribute('href');

  if (!href) return;
  if (href.startsWith('/')) return;
  if (href.startsWith('http:')) return;

  cardLink.setAttribute('card', href);
  cardLink.removeAttribute('href');

}

const cardAttributeToHref = (a) => {

  let card = a.getAttribute('card');

  if (!card) return;

  a.setAttribute('href', card);
  a.removeAttribute('card');

}

const normalizeBodyFromContentEditable = (html) => {

  //Rewrite elements from content editable form to canonical form (which is
  //primarily replacing <a>'s with <card-link>.)

  //This transform should be the inverse, semantically, of normalizeBodyFromCotentEditable

  html = replaceAsWithCardLinks(html);

  //This is the part where we do live-node fix-ups of stuff that
  //contenteditable might have erroneously spewed in.

  let section = document.createElement("section");
  //TODO: catch syntax errors
  section.innerHTML = html;

  //createLink will have <a href='cardid'>. We will have changed the <a> to
  //<card-link> already, but the href should be a card attribute.
  section.querySelectorAll('card-link').forEach(hrefToCardAttribute);

  return section.innerHTML;
}

export const normalizeBodyToContentEditable = (html) => {
  //inverse transform of normalizeBodyFromContentEditable. contentEditable
  //expects links to be, for example, actual link elements. We only do
  //transforms that are necessary for Chrome's content editable to understand
  //our content. For example, although Chrome's content editable places <b>'s,
  //it understands that <strong>'s are the same thing for the purpose of
  //unbolding.

  html = replaceCardLinksWithAs(html);

  //This is the part where we do live-node fix-ups of stuff that
  //contenteditable might have erroneously spewed in.

  let section = document.createElement("section");
  //TODO: catch syntax errors
  section.innerHTML = html;

  section.querySelectorAll('a').forEach(cardAttributeToHref);

  return section.innerHTML;

}

const cleanUpHTMLDeep = (html) => {
  //Does deeper changes that require parsing.
  //1) make sure all text in top body is within a p tag.
  //2) make sure that p elements don't have any line breaks inside.
  let section = document.createElement('section');
  section.innerHTML = html;
  let children = section.childNodes;
  for (let child of Object.values(children)) {
    if (child.nodeType == 3) {
      if (/^\s+$/.test(child.textContent)) {
        //It's all text content, just replace it with a single line break
        child.textContent = '\n';
      } else {
        //TODO: here replace the node with a <p> with the text content.
        let p = document.createElement('p');
        p.innerText = child.textContent.trim();
        child.parentNode.replaceChild(p, child);
        //Deliberately drop dwon into the next processing step.
        child = p;
      }
    }
    if (child.nodeType == 1) {
      if (child.localName == 'p') {
        let inner = child.innerHTML;
        inner = inner.trim();
        inner = inner.split("\n").join("");
        child.innerHTML = inner;
      }
    }

  }

  return section.innerHTML;

}

const removeDoubleLineBreaks = (html) => {
  while (html.indexOf("\n\n") >= 0) {
    html = html.split("\n\n").join("\n");
  }
  return html;
}

const normalizeBodyHTML = (html) => {

  //normalizeBodyHTML makes sure that the html is well formatted. It first
  //does basic string processing to clean it up, and then does node
  //modification. Thus, it assumes the HTML is always valid. This is true if
  //the html is coming directly from a contentEditable, or if it's the final
  //stage before commit.

  //normalizeBodyHTML should do processing on the HTML (that comes potentially
  //from contentEditable) to represent it in a sane, simple way that should
  //ideally not change the display of the content, just structure the markup
  //differently.

  //Ensure that after every block element we have a new line. Don't worry
  //about putting in extra; we'll remove them in the next step.

  html = cleanUpHTMLDeep(html);

  html = html.split("</p>").join("</p>\n");
  html = html.split("<b>").join("<strong>");
  html = html.split("</b>").join("</strong>");
  html = html.split("<i>").join("<em>");
  html = html.split("</i>").join("</em>");

  //Remove any extra linke breaks (which we might have added)
  html = removeDoubleLineBreaks(html);

  

  return normalizeBodyFromContentEditable(html);

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
    body: fromContentEditable ? normalizeBodyHTML(newBody) : newBody,
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
