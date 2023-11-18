//Versions of Object.entries(), Object.keys(), and Object.values() that preserve
//type for constrained type maps. By default they return [string, any]

//Use: instead of Object.keys(), do TypedObject.keys()

type Entries<T> = { [K in Extract<keyof T, string>]: [K, T[K]] }[Extract<keyof T, string>][];

export class TypedObject {

	//Based on https://stackoverflow.com/a/59459000
	static keys<T extends object>(t : T): Array<keyof T> {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return Object.keys(t) as any;
	}

	//Based on https://stackoverflow.com/a/62055863 and https://chat.openai.com/c/83d8e6d6-8ac1-4301-9bc3-6c0eb4f2af36
	static entries<T>(obj: T): Entries<T> {
		return Object.entries(obj) as unknown as Entries<T>;
	}
}