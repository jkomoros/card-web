//Leaf module (no app imports) for the Collection Composer rollout capability.
//Keeping this separate lets routing, commands, and components consult the
//same typed switch without creating import cycles.
//
//  'off'      (default) — existing collection navigation only.
//  'dogfood'            — incomplete development/admin slices and parser
//                         shadow diagnostics may be exposed.
//  'on'                 — production-ready composer for normal users.

const LOCAL_STORAGE_KEY = "collection-composer";
const PREVIEW_LOCAL_STORAGE_KEY = "collection-composer-preview";

export type CollectionComposerMode = "off" | "dogfood" | "on";

export const readCollectionComposerMode = (): CollectionComposerMode => {
  if (typeof window === "undefined") return "off";
  try {
    const value = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (value === "dogfood" || value === "on") return value;
  } catch {
    //Best effort: capability remains safely disabled.
  }
  //A non-persistent development/admin override makes a dogfood URL easy to
  //open and share without changing a browser profile. Hash state is ignored by
  //the collection router and vanishes when the hash is removed.
  try {
    const value = new URLSearchParams(window.location?.hash.slice(1) || "").get(
      LOCAL_STORAGE_KEY
    );
    if (value === "dogfood" || value === "on") return value;
  } catch {
    //Best effort
  }
  return "off";
};

export const writeCollectionComposerMode = (
  mode: CollectionComposerMode
): void => {
  if (typeof window === "undefined") return;
  try {
    if (mode === "off") {
      window.localStorage.removeItem(LOCAL_STORAGE_KEY);
    } else {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, mode);
    }
  } catch {
    //Best effort
  }
};

//The master capability. Dogfood deliberately enables unfinished vertical
//slices without implying that they are ready for normal users.
export const collectionComposerEnabled = (): boolean =>
  readCollectionComposerMode() !== "off";

export const collectionComposerPublicEnabled = (): boolean =>
  readCollectionComposerMode() === "on";

//Shadow diagnostics may inspect behavior but must never alter production
//navigation. Keep them limited to the explicit dogfood mode.
export const collectionComposerParserShadowEnabled = (): boolean =>
  readCollectionComposerMode() === "dogfood";

export const collectionComposerPreviewEnabled = (): boolean => {
  if (!collectionComposerEnabled() || typeof window === "undefined")
    return false;
  try {
    if (window.localStorage.getItem(PREVIEW_LOCAL_STORAGE_KEY) === "on")
      return true;
    return (
      new URLSearchParams(window.location?.hash.slice(1) || "").get(
        PREVIEW_LOCAL_STORAGE_KEY
      ) === "on"
    );
  } catch {
    return false;
  }
};

export const writeCollectionComposerPreviewEnabled = (
  enabled: boolean
): void => {
  if (typeof window === "undefined") return;
  try {
    if (enabled) {
      window.localStorage.setItem(PREVIEW_LOCAL_STORAGE_KEY, "on");
    } else {
      window.localStorage.removeItem(PREVIEW_LOCAL_STORAGE_KEY);
    }
  } catch {
    //Best effort
  }
};
