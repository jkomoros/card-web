//Persistent storage for large card-derived filter sets.
//
//A card-derived filter ("has-todo", "unpublished", ...) is a set of card ids
//that the collection reducer recomputes as cards change. As plain
//{[id]: true} maps, every single-card change at 47k cards copied the whole
//map for every filter the card touched (~78 maps), which was the dominant
//per-edit allocation on both threads. A CardDerivedMembership is instead a
//bitset over a shared, append-only id domain: a one-card update copies one
//1024-id chunk of bits, and an unchanged filter keeps its identity.
//
//The runtime objects are opaque authority tokens: native cloning
//intentionally does not preserve them (a structuredClone yields {}). Wire
//boundaries must call membershipToFilterMap explicitly, and consumers go
//through membershipHas / membershipKeys; tools/check-filter-membership.cjs
//is the type-aware guard that catches native enumeration of one.
type PlainFilterMap = {[cardID: string]: true};
type Membership = PlainFilterMap | CardDerivedMembership;
type OrderEntry = readonly [ordinal: number, version: number];

const IDS_PER_CHUNK = 1024;
const WORDS_PER_CHUNK = IDS_PER_CHUNK / 32;
const ORDER_CHUNK_SIZE = 256;
const COMPACTION_MIN_TOMBSTONES = 1024;
const AUTHORITY = Symbol('filter-membership-authority');

//An id domain assigns each id an ordinal, append-only along a lineage. Every
//domain in a lineage shares ONE index map (the lineage tip's): an older
//domain reads the same map and treats ordinals at or beyond its own size as
//absent, so it never sees ids added after it was taken. Extending the tip
//appends to the shared map in place; extending a held older snapshot (rare:
//a stale sibling being updated) copies the map's prefix, which starts a new
//lineage. The map is reachable only through domains, which are reachable
//only through memberships, so discarding every membership of a lineage
//frees its index.
//
//This replaces the parked branch's path-copied AVL tree: a Map lookup is
//~1.3ms per 47k ids against ~9.5ms for the tree, and the tip extension
//allocates nothing per id beyond the map entry.
type DomainState = Readonly<{
	ids: readonly (readonly string[])[];
	index: Map<string, number>;
	size: number;
}>;

type MembershipState = Readonly<{
	domain: DomainState;
	bits: readonly Uint32Array[];
	versions: readonly Uint32Array[];
	order: readonly (readonly OrderEntry[])[];
	size: number;
	orderEntries: number;
}>;

const membershipStates = new WeakMap<CardDerivedMembership, MembershipState>();

export class CardDerivedMembership {
	declare private readonly _cardDerivedMembershipBrand : void;
	constructor(authority : symbol) {
		if (authority !== AUTHORITY) throw new Error('CardDerivedMembership is created by filter membership helpers');
		Object.freeze(this);
	}
}

const membershipState = (membership : CardDerivedMembership) : MembershipState => {
	const state = membershipStates.get(membership);
	if (!state) throw new Error('Invalid CardDerivedMembership');
	return state;
};

const wrapMembership = (state : MembershipState) : CardDerivedMembership => {
	const membership = new CardDerivedMembership(AUTHORITY);
	membershipStates.set(membership, state);
	return membership;
};

const emptyDomainState = () : DomainState => Object.freeze({
	ids: Object.freeze([]) as readonly (readonly string[])[],
	index: new Map<string, number>(),
	size: 0,
});

const ordinalFor = (domain : DomainState, id : string) : number | undefined => {
	const ordinal = domain.index.get(id);
	return ordinal !== undefined && ordinal < domain.size ? ordinal : undefined;
};
const idFor = (domain : DomainState, ordinal : number) : string => domain.ids[Math.floor(ordinal / IDS_PER_CHUNK)][ordinal % IDS_PER_CHUNK];

//The domain is immutable from a reader's view: a returned state never changes
//which ids it maps. Extending the tip of a lineage shares the index map and
//the complete id chunks; only the final chunk is copied.
const extendDomain = (prior : DomainState, ids : readonly string[]) : DomainState => {
	const additions : string[] = [];
	const seen = new Set<string>();
	for (const id of ids) {
		if (ordinalFor(prior, id) !== undefined || seen.has(id)) continue;
		seen.add(id);
		additions.push(id);
	}
	if (!additions.length) return prior;
	let index = prior.index;
	if (index.size !== prior.size) {
		//prior is not the lineage tip: later ids already occupy the shared
		//map. Copy its prefix so the two lineages diverge cleanly.
		index = new Map<string, number>();
		for (const [id, ordinal] of prior.index) if (ordinal < prior.size) index.set(id, ordinal);
	}
	const chunks = prior.ids.slice();
	let tail = chunks.length ? [...chunks[chunks.length - 1]] : [];
	if (chunks.length) chunks[chunks.length - 1] = tail;
	else chunks.push(tail);
	let size = prior.size;
	for (const id of additions) {
		if (tail.length === IDS_PER_CHUNK) {
			tail = [];
			chunks.push(tail);
		}
		index.set(id, size++);
		tail.push(id);
	}
	return Object.freeze({
		ids: Object.freeze(chunks.map(chunk => Object.isFrozen(chunk) ? chunk : Object.freeze(chunk))),
		index,
		size,
	});
};

const domainIsAncestor = (possibleAncestor : DomainState, domain : DomainState) : boolean => {
	if (possibleAncestor.size > domain.size) return false;
	//Same shared index means same lineage, and ordinals are append-only.
	if (possibleAncestor.index === domain.index) return true;
	const completeChunks = Math.floor(possibleAncestor.size / IDS_PER_CHUNK);
	for (let index = 0; index < completeChunks; index++) {
		if (possibleAncestor.ids[index] === domain.ids[index]) continue;
		const left = possibleAncestor.ids[index];
		const right = domain.ids[index];
		for (let offset = 0; offset < IDS_PER_CHUNK; offset++) if (left[offset] !== right[offset]) return false;
	}
	const remaining = possibleAncestor.size % IDS_PER_CHUNK;
	if (!remaining) return true;
	const left = possibleAncestor.ids[completeChunks];
	const right = domain.ids[completeChunks];
	if (left === right) return true;
	for (let offset = 0; offset < remaining; offset++) if (left[offset] !== right[offset]) return false;
	return true;
};

export const isCardDerivedMembership = (value : unknown) : value is CardDerivedMembership =>
	value instanceof CardDerivedMembership && membershipStates.has(value);

const hasOrdinal = (state : MembershipState, ordinal : number) : boolean => {
	const offset = ordinal % IDS_PER_CHUNK;
	const chunk = state.bits[Math.floor(ordinal / IDS_PER_CHUNK)];
	return Boolean(chunk && (chunk[offset >>> 5] & (1 << (offset & 31))));
};

export const membershipHas = (membership : Membership, id : string) : boolean => {
	if (!isCardDerivedMembership(membership)) {
		return Object.prototype.hasOwnProperty.call(membership, id) && Boolean(membership[id]);
	}
	const state = membershipState(membership);
	const ordinal = ordinalFor(state.domain, id);
	return ordinal !== undefined && hasOrdinal(state, ordinal);
};

//Plain objects enumerate array-index keys first, ascending, then the rest in
//insertion order. membershipKeys reproduces that so a membership and the
//plain map it stands in for enumerate identically.
const arrayIndex = (id : string) : number | null => {
	const value = Number(id);
	return Number.isInteger(value) && value >= 0 && value < 0xFFFFFFFF && String(value) === id ? value : null;
};

export const membershipKeys = (membership : Membership) : string[] => {
	if (!isCardDerivedMembership(membership)) return Object.keys(membership);
	const state = membershipState(membership);
	const numeric : [number, string][] = [];
	const ordinary : string[] = [];
	for (const chunk of state.order) for (const [ordinal, version] of chunk) {
		if (!hasOrdinal(state, ordinal)) continue;
		const offset = ordinal % IDS_PER_CHUNK;
		if (state.versions[Math.floor(ordinal / IDS_PER_CHUNK)]?.[offset] !== version) continue;
		const id = idFor(state.domain, ordinal);
		const index = arrayIndex(id);
		if (index === null) ordinary.push(id);
		else numeric.push([index, id]);
	}
	numeric.sort((a, b) => a[0] - b[0]);
	return [...numeric.map(([, id]) => id), ...ordinary];
};

export const membershipEntries = (membership : Membership) : [string, true][] => membershipKeys(membership).map(id => [id, true]);
export const membershipSize = (membership : Membership) : number => isCardDerivedMembership(membership) ? membershipState(membership).size : Object.keys(membership).length;
export const membershipToFilterMap = (membership : Membership) : PlainFilterMap => isCardDerivedMembership(membership) ? Object.fromEntries(membershipKeys(membership).map(id => [id, true])) : membership;
//Exposes token identity only for memo/cache keys. Callers must use the
//membership helpers, rather than inspecting this object, for set contents.
export const membershipIdentity = (membership : Membership) : object => membership;

const mutableChunk = (source : readonly Uint32Array[], changed : Map<number, Uint32Array>, index : number, words : number) : Uint32Array => {
	let chunk = changed.get(index);
	if (chunk) return chunk;
	chunk = source[index]?.slice() || new Uint32Array(words);
	changed.set(index, chunk);
	return chunk;
};

const appendOrder = (source : readonly (readonly OrderEntry[])[], entries : OrderEntry[]) : readonly (readonly OrderEntry[])[] => {
	if (!entries.length) return source;
	const result = source.slice();
	let tail = result.length ? [...result[result.length - 1]] : [];
	if (result.length) result[result.length - 1] = tail;
	else result.push(tail);
	for (const entry of entries) {
		if (tail.length === ORDER_CHUNK_SIZE) {
			tail = [];
			result.push(tail);
		}
		tail.push(entry);
	}
	return Object.freeze(result.map(chunk => Object.isFrozen(chunk) ? chunk : Object.freeze(chunk)));
};

const buildMembership = (ids : readonly string[], domain : DomainState) : CardDerivedMembership => {
	const bits : Uint32Array[] = [];
	const versions : Uint32Array[] = [];
	const entries : OrderEntry[] = [];
	for (const id of ids) {
		const ordinal = ordinalFor(domain, id)!;
		const chunkIndex = Math.floor(ordinal / IDS_PER_CHUNK);
		const offset = ordinal % IDS_PER_CHUNK;
		bits[chunkIndex] ||= new Uint32Array(WORDS_PER_CHUNK);
		versions[chunkIndex] ||= new Uint32Array(IDS_PER_CHUNK);
		bits[chunkIndex][offset >>> 5] |= 1 << (offset & 31);
		versions[chunkIndex][offset] = 1;
		entries.push([ordinal, 1]);
	}
	return wrapMembership({domain, bits: Object.freeze(bits), versions: Object.freeze(versions), order: appendOrder([], entries), size: ids.length, orderEntries: ids.length});
};

type MembershipChange = Readonly<{membership: Membership; add?: readonly string[]; remove?: readonly string[]}>;

const updateOnDomain = (previous : CardDerivedMembership, domain : DomainState, change : MembershipChange) : CardDerivedMembership => {
	const prior = membershipState(previous);
	const changedBits = new Map<number, Uint32Array>();
	const changedVersions = new Map<number, Uint32Array>();
	const additions : OrderEntry[] = [];
	let size = prior.size;

	for (const id of change.remove || []) {
		const ordinal = ordinalFor(domain, id);
		if (ordinal === undefined) continue;
		const chunkIndex = Math.floor(ordinal / IDS_PER_CHUNK);
		const offset = ordinal % IDS_PER_CHUNK;
		const current = changedBits.get(chunkIndex) || prior.bits[chunkIndex];
		const mask = 1 << (offset & 31);
		if (!current || !(current[offset >>> 5] & mask)) continue;
		const bits = mutableChunk(prior.bits, changedBits, chunkIndex, WORDS_PER_CHUNK);
		bits[offset >>> 5] &= ~mask;
		size--;
	}
	for (const id of change.add || []) {
		const ordinal = ordinalFor(domain, id)!;
		const chunkIndex = Math.floor(ordinal / IDS_PER_CHUNK);
		const offset = ordinal % IDS_PER_CHUNK;
		const current = changedBits.get(chunkIndex) || prior.bits[chunkIndex];
		const mask = 1 << (offset & 31);
		if (current && (current[offset >>> 5] & mask)) continue;
		const bits = mutableChunk(prior.bits, changedBits, chunkIndex, WORDS_PER_CHUNK);
		bits[offset >>> 5] |= mask;
		const versions = mutableChunk(prior.versions, changedVersions, chunkIndex, IDS_PER_CHUNK);
		versions[offset]++;
		additions.push([ordinal, versions[offset]]);
		size++;
	}
	//A membership can safely retain an older domain prefix when its bits did
	//not change. Ordinals are append-only along a domain lineage, so a later
	//changed sibling can advance without invalidating this snapshot or
	//needlessly changing its identity.
	if (!changedBits.size) return previous;

	const bits = prior.bits.slice();
	const versions = prior.versions.slice();
	for (const [index, chunk] of changedBits) bits[index] = chunk;
	for (const [index, chunk] of changedVersions) versions[index] = chunk;
	return wrapMembership({
		domain,
		bits: Object.freeze(bits),
		versions: Object.freeze(versions),
		order: appendOrder(prior.order, additions),
		size,
		orderEntries: prior.orderEntries + additions.length,
	});
};

export const cardDerivedMembershipsFromFilterMaps = (maps : readonly PlainFilterMap[]) : CardDerivedMembership[] => {
	const allIDs = maps.flatMap(map => Object.keys(map));
	const next = extendDomain(emptyDomainState(), allIDs);
	const equivalent = new Map<PlainFilterMap, CardDerivedMembership>();
	let empty : CardDerivedMembership | undefined;
	return maps.map(map => {
		let membership = equivalent.get(map);
		if (membership) return membership;
		const keys = Object.keys(map);
		membership = !keys.length && empty ? empty : buildMembership(keys, next);
		if (!keys.length) empty = membership;
		equivalent.set(map, membership);
		return membership;
	});
};

export const cardDerivedMembershipFromFilterMap = (map : PlainFilterMap) : CardDerivedMembership => {
	return cardDerivedMembershipsFromFilterMaps([map])[0];
};

export const updateCardDerivedMembershipGroup = (changes : readonly MembershipChange[]) : CardDerivedMembership[] => {
	if (!changes.length) return [];
	const derivedStates = changes
		.filter(change => isCardDerivedMembership(change.membership))
		.map(change => membershipState(change.membership as CardDerivedMembership));
	const baseDomain = derivedStates.reduce(
		(latest, state) => state.domain.size > latest.size ? state.domain : latest,
		derivedStates[0]?.domain || emptyDomainState(),
	);
	if (derivedStates.some(state => !domainIsAncestor(state.domain, baseDomain))) {
		throw new Error('Card-derived membership group does not share one domain lineage');
	}
	const allIDs = changes.flatMap(change => [
		...(!isCardDerivedMembership(change.membership) ? Object.keys(change.membership) : []),
		...(change.add || []),
	]);
	const domain = extendDomain(baseDomain, allIDs);
	const imported = new Map<PlainFilterMap, CardDerivedMembership>();
	let importedEmpty : CardDerivedMembership | undefined;
	const equivalent = new Map<CardDerivedMembership, Map<string, CardDerivedMembership>>();
	const updated = changes.map(change => {
		let previous : CardDerivedMembership;
		if (isCardDerivedMembership(change.membership)) {
			previous = change.membership;
		} else {
			const keys = Object.keys(change.membership);
			previous = imported.get(change.membership) || (!keys.length && importedEmpty ? importedEmpty : buildMembership(keys, domain));
			if (!keys.length) importedEmpty = previous;
			imported.set(change.membership, previous);
		}
		const deltaKey = JSON.stringify([change.remove || [], change.add || []]);
		let byDelta = equivalent.get(previous);
		if (!byDelta) {
			byDelta = new Map();
			equivalent.set(previous, byDelta);
		}
		const same = byDelta.get(deltaKey);
		if (same) return same;
		const result = updateOnDomain(previous, domain, change);
		byDelta.set(deltaKey, result);
		return result;
	});

	const needsOrderCompaction = (membership : CardDerivedMembership) : boolean => {
		const state = membershipState(membership);
		const tombstones = state.orderEntries - state.size;
		return tombstones >= COMPACTION_MIN_TOMBSTONES && tombstones > state.size;
	};
	if (!updated.some(needsOrderCompaction)) return updated;

	//Order-log tombstones do not require rebuilding the ID domain or unrelated
	//siblings. Rebuild only affected memberships against the current domain.
	const compactedByMembership = new Map<CardDerivedMembership, CardDerivedMembership>();
	const orderCompacted = updated.map(membership => {
		if (!needsOrderCompaction(membership)) return membership;
		let compacted = compactedByMembership.get(membership);
		if (!compacted) {
			compacted = buildMembership(membershipKeys(membership), domain);
			compactedByMembership.set(membership, compacted);
		}
		return compacted;
	});

	//Reclaim the shared ID index only after deletion churn makes it more than
	//twice the live union (with a 1024-ID floor). This scan is paid only at an
	//order-compaction boundary, not on ordinary bounded card deltas.
	const largestMembership = orderCompacted.reduce((largest, membership) => Math.max(largest, membershipState(membership).size), 0);
	if (domain.size <= largestMembership * 2 + COMPACTION_MIN_TOMBSTONES) return orderCompacted;
	let unused = 0;
	for (let ordinal = 0; ordinal < domain.size; ordinal++) {
		if (!orderCompacted.some(membership => hasOrdinal(membershipState(membership), ordinal))) unused++;
	}
	if (unused < COMPACTION_MIN_TOMBSTONES || unused * 2 <= domain.size) return orderCompacted;

	const maps : PlainFilterMap[] = [];
	const mapForMembership = new Map<CardDerivedMembership, PlainFilterMap>();
	for (const membership of orderCompacted) {
		let map = mapForMembership.get(membership);
		if (!map) {
			map = Object.fromEntries(membershipKeys(membership).map(id => [id, true]));
			mapForMembership.set(membership, map);
		}
		maps.push(map);
	}
	return cardDerivedMembershipsFromFilterMaps(maps);
};

export const updateCardDerivedMembership = (previous : CardDerivedMembership, change : Readonly<{add?: readonly string[]; remove?: readonly string[]}>) : CardDerivedMembership => updateCardDerivedMembershipGroup([{membership: previous, ...change}])[0];
