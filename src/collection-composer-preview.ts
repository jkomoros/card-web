import { CollectionComposerSuggestion } from "./collection-composer-suggestions.js";

type PreviewResult = { numCards: number };
type PreviewRunner = (
  description: string,
  keyCardID: string
) => Promise<PreviewResult | null> | null;

export const startCollectionComposerPreviews = (
  suggestions: CollectionComposerSuggestion[],
  keyCardID: string,
  run: PreviewRunner,
  onCount: (suggestionID: string, count: number) => void
): (() => void) => {
  let active = true;
  for (const suggestion of suggestions) {
    const pending = run(
      suggestion.description.serializeOriginalOrder(),
      keyCardID
    );
    if (!pending) continue;
    pending
      .then((result) => {
        if (!active || !result) return;
        onCount(suggestion.id, result.numCards);
      })
      .catch(() => {
        //Previews are progressive enhancement. Worker failures leave the
        //suggestion usable without a count.
      });
  }
  return () => {
    active = false;
  };
};
