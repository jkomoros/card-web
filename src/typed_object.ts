//Versions of Object.entries(), Object.keys(), and Object.values() that preserve
//type for constrained type maps. By default they return [string, any]

//Use: instead of Object.keys(), do TypedObject.keys()

type Entries<T> = { [K in keyof T]: [K, T[K]] }[keyof T];

export class TypedObject {

	//Based on https://stackoverflow.com/a/59459000
	static keys<T extends object>(t : T): Array<keyof T> {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return Object.keys(t) as any;
	}

	//Based on https://stackoverflow.com/a/62055863
	static entries<T extends object>(t: T): Entries<T>[] {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return Object.entries(t) as any;
	}
}