export type NavigationCommitDecision =
  | { status: "unchanged"; path: string; history: "none" }
  | { status: "blocked-editing"; path: string; history: "none" }
  | {
      status: "commit";
      path: string;
      history: "push" | "replace";
    };

export type NavigationCommitResult =
  | Exclude<NavigationCommitDecision, { status: "commit" }>
  | {
      status: "committed";
      requestedPath: string;
      committedPath: string;
      history: "push" | "replace";
    };

export const normalizeNavigationPath = (path: string): string =>
  path.startsWith("/") ? path : `/${path}`;

export const navigationCommitDecision = (
  currentPath: string,
  requestedPath: string,
  editing: boolean,
  silent = false
): NavigationCommitDecision => {
  const path = normalizeNavigationPath(requestedPath);
  if (path === normalizeNavigationPath(currentPath))
    return { status: "unchanged", path, history: "none" };
  if (editing)
    return { status: "blocked-editing", path, history: "none" };
  return { status: "commit", path, history: silent ? "replace" : "push" };
};
