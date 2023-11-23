//Versions of Object.entries(), Object.keys(), and Object.values() that preserve
//type for constrained type maps. By default they return [string, any]

//Use: instead of Object.keys(), do TypedObject.keys()

type Entries<T> = { [K in Extract<keyof T, string>]: [K, T[K]] }[Extract<keyof T, string>][];

export class TypedObject {
	// Ensures T is an object with string keys
	//eslint-disable-next-line @typescript-eslint/no-explicit-any
	static keys<T extends { [key: string]: any }>(obj: T): Array<keyof T> {
		return Object.keys(obj) as Array<keyof T>;
	}

	//eslint-disable-next-line @typescript-eslint/no-explicit-any
	static entries<T extends { [key: string]: any }>(obj: T): Entries<T> {
		return Object.entries(obj) as unknown as Entries<T>;
	}
}