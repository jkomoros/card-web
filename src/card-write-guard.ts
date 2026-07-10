//Moved to shared/ so the ADMIN MultiBatch (tools/mount.ts) gets the same
//chokepoint as the client one — the guard's policy must not depend on which
//SDK performs the write. This shim preserves existing import sites.
export * from '../shared/card-write-guard.js';
