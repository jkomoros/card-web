//Versions of Object.entries(), Object.keys(), and Object.values() that preserve
//type for constrained type maps. By default they return [string, any]

//Based on https://stackoverflow.com/a/62055863
type Entries<T> = { [K in keyof T]: [K, T[K]] }[keyof T];

export function ObjectEntries<T extends object>(t: T): Entries<T>[] {
  return Object.entries(t) as any;
}

//Based on https://stackoverflow.com/a/59459000
export const ObjectKeys = Object.keys as <T extends object>(obj: T) => Array<keyof T>;