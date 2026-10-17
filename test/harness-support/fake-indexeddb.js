/*eslint-env node, es2022*/

//A deliberately small in-memory IndexedDB for the snapshot store's tests:
//open (with upgrade), one object store, get/put/delete requests, transactions
//that auto-commit once their request queue drains, abort(), and the one
//detail that mattered in the field — a request error event reaches the
//transaction BEFORE transaction.error is set, as in Chromium. `maxValueBytes`
//makes a put fail the way Chromium refuses an oversized value, so the
//chunking that works around that limit can be exercised without a browser.
//An aborted transaction rolls back (records are snapshotted at the first
//write and restored), and its still-pending requests fire an AbortError, as
//in Chromium — a store that records "the last failure" would report that
//bystander instead of the cause. Values are kept per database name across
//connections, like a real one. `delete` accepts an IDBKeyRange (string keys,
//closed bounds), which is all the store uses.

class FakeKeyRange {
	constructor(lower, upper) { this.lower = lower; this.upper = upper; }
	static bound(lower, upper) { return new FakeKeyRange(lower, upper); }
	includes(key) { return key >= this.lower && key <= this.upper; }
}

const databases = new Map();

const makeError = (name, message) => { const error = new Error(message); error.name = name; return error; };

class FakeRequest {
	constructor() { this.result = undefined; this.error = null; this.onsuccess = null; this.onerror = null; }
}

class FakeObjectStore {
	constructor(transaction, records) {
		this._transaction = transaction;
		this._records = records;
	}
	_enqueue(work) {
		const request = new FakeRequest();
		const transaction = this._transaction;
		if (transaction._finished) throw makeError('TransactionInactiveError', 'transaction is not active');
		transaction._pending++;
		queueMicrotask(() => {
			transaction._pending--;
			if (transaction._aborted) {
				//Requests still queued when the transaction aborted fail with
				//AbortError, after the cause's own error event.
				request.error = makeError('AbortError', 'The transaction was aborted, so the request cannot be fulfilled.');
				if (request.onerror) request.onerror({target: request});
				return;
			}
			try {
				request.result = work();
				if (request.onsuccess) request.onsuccess({target: request});
			} catch (error) {
				request.error = error;
				//The request's error event fires while transaction.error is
				//still null; the abort follows and sets it.
				if (request.onerror) request.onerror({target: request});
				transaction._abort(error);
			}
			transaction._maybeComplete();
		});
		return request;
	}
	get(key) { return this._enqueue(() => (this._records.has(key) ? this._records.get(key) : undefined)); }
	put(value, key) {
		return this._enqueue(() => {
			const limit = this._transaction._db._state.maxValueBytes;
			const size = JSON.stringify(value).length;
			if (limit && size > limit) throw makeError('UnknownError', `The serialized keys and/or value are too large (size=${size} bytes, max=${limit} bytes).`);
			this._transaction._beforeWrite();
			this._records.set(key, structuredClone(value));
			return key;
		});
	}
	delete(keyOrRange) {
		return this._enqueue(() => {
			this._transaction._beforeWrite();
			if (keyOrRange instanceof FakeKeyRange) {
				for (const key of [...this._records.keys()]) if (keyOrRange.includes(key)) this._records.delete(key);
			} else {
				this._records.delete(keyOrRange);
			}
			return undefined;
		});
	}
}

class FakeTransaction {
	constructor(db, records) {
		this._db = db;
		this._records = records;
		this._pending = 0;
		this._finished = false;
		this._aborted = false;
		this._before = null;
		this.error = null;
		this.oncomplete = null;
		this.onerror = null;
		this.onabort = null;
	}
	objectStore() { return new FakeObjectStore(this, this._records); }
	abort() { this._abort(null); }
	_beforeWrite() { if (!this._before) this._before = new Map(this._records); }
	_abort(error) {
		if (this._finished) return;
		this._finished = true;
		this._aborted = true;
		this.error = error;
		if (this._before) {
			this._records.clear();
			for (const [key, value] of this._before) this._records.set(key, value);
		}
		//Pending requests get their AbortError first (they are ahead of this
		//in the microtask queue); the abort event fires after all of them.
		setTimeout(() => { if (this.onabort) this.onabort({target: this}); }, 0);
	}
	_maybeComplete() {
		if (this._finished || this._pending > 0) return;
		//Requests queued by a success handler run before this settles.
		setTimeout(() => {
			if (this._finished || this._pending > 0) return;
			this._finished = true;
			if (this.oncomplete) this.oncomplete({target: this});
		}, 0);
	}
}

class FakeDatabase {
	constructor(name, state) {
		this._name = name;
		this._state = state;
		this.onversionchange = null;
		this.objectStoreNames = {contains: storeName => state.stores.has(storeName)};
	}
	createObjectStore(storeName) { if (!this._state.stores.has(storeName)) this._state.stores.set(storeName, new Map()); }
	transaction(storeName) {
		const records = this._state.stores.get(storeName);
		if (!records) throw makeError('NotFoundError', 'no such object store');
		return new FakeTransaction(this, records);
	}
	close() { /* nothing held */ }
}

export const installFakeIndexedDB = ({maxValueBytes = 0} = {}) => {
	databases.clear();
	globalThis.IDBKeyRange = FakeKeyRange;
	globalThis.indexedDB = {
		open(name) {
			const request = new FakeRequest();
			request.onupgradeneeded = null;
			request.onblocked = null;
			queueMicrotask(() => {
				let state = databases.get(name);
				const fresh = !state;
				if (fresh) { state = {stores: new Map(), maxValueBytes}; databases.set(name, state); }
				state.maxValueBytes = maxValueBytes;
				request.result = new FakeDatabase(name, state);
				if (fresh && request.onupgradeneeded) request.onupgradeneeded({target: request});
				if (request.onsuccess) request.onsuccess({target: request});
			});
			return request;
		},
		deleteDatabase(name) { databases.delete(name); const request = new FakeRequest(); queueMicrotask(() => { if (request.onsuccess) request.onsuccess({target: request}); }); return request; },
	};
	return {
		//Raw records of one store, for assertions about what landed on disk.
		records: (name, storeName) => databases.get(name)?.stores.get(storeName) || new Map(),
		//Change the limit between saves on the same database.
		setMaxValueBytes: (bytes) => { for (const state of databases.values()) state.maxValueBytes = bytes; },
	};
};
