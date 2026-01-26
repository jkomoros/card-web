/**
 * Discovered Cards Manager
 *
 * Manages the "discovered tier" of cards - a warm cache of cards that the user
 * has navigated to or searched for, but which aren't in the hot tier (5k most
 * recent cards).
 *
 * This module coordinates:
 * - Tracking when cards are discovered (via navigation, search, references)
 * - Fetching full card data from Firestore on-demand via getDoc()
 * - Coordinating with LRU eviction to manage cache size
 * - Loading/saving from IndexedDB for persistence across sessions
 */

import {
	doc,
	getDoc
} from 'firebase/firestore';

import {
	db
} from './firebase.js';

import {
	CARDS_COLLECTION
} from '../shared/collection-constants.js';

import type {
	CardID,
	Card,
	Cards
} from './types.js';

import type {
	ThunkSomeAction
} from './store.js';

import {
	receiveCards
} from './actions/data.js';

import {
	store
} from './store.js';

/**
 * Discovery method tracks how a card entered the discovered tier.
 * Used for debugging and potential future analytics.
 */
export type DiscoveryMethod =
	| 'navigation'  // User navigated directly to the card
	| 'search'      // Card appeared in search results
	| 'reference';  // User followed a reference link

/**
 * Metadata about a discovered card
 */
export interface DiscoveredCardMetadata {
	// When this card was first discovered
	firstDiscoveredAt: number;
	// Most recent access timestamp (for LRU)
	lastAccessedAt: number;
	// How this card was discovered
	discoveryMethod: DiscoveryMethod;
}

/**
 * Manager for the discovered cards tier.
 * This is a singleton that coordinates card discovery, fetching, and caching.
 */
class DiscoveredCardsManager {
	// Metadata about discovered cards (separate from card data itself)
	private metadata: Map<CardID, DiscoveredCardMetadata> = new Map();

	/**
	 * Track a card as discovered. This is called when:
	 * - User navigates to a card (via showCard action)
	 * - Card appears in search results
	 * - User follows a reference link
	 *
	 * This does NOT fetch the card data immediately - that happens in fetchCard().
	 */
	discoverCard(cardID: CardID, method: DiscoveryMethod = 'navigation'): void {
		const now = Date.now();
		const existing = this.metadata.get(cardID);

		if (existing) {
			// Card already discovered - just update access time
			existing.lastAccessedAt = now;
		} else {
			// New discovery
			this.metadata.set(cardID, {
				firstDiscoveredAt: now,
				lastAccessedAt: now,
				discoveryMethod: method
			});
		}
	}

	/**
	 * Fetch a card from Firestore if it's not already in the hot tier.
	 * Returns the card if found, null if not found or if there's an error.
	 *
	 * This is called automatically by the Redux action when a card is needed
	 * but not in the hot tier.
	 */
	async fetchCard(cardID: CardID): Promise<Card | null> {
		try {
			const docRef = doc(db, CARDS_COLLECTION, cardID);
			const snapshot = await getDoc(docRef);

			if (!snapshot.exists()) {
				console.warn(`[DiscoveredCards] Card ${cardID} not found in Firestore`);
				return null;
			}

			const card = snapshot.data() as Card;

			// Ensure the card has its ID
			if (!card.id) {
				card.id = cardID;
			}

			return card;
		} catch (error) {
			console.error(`[DiscoveredCards] Error fetching card ${cardID}:`, error);
			return null;
		}
	}

	/**
	 * Check if a card is available (either in hot tier or discovered tier).
	 * This is a fast check that doesn't fetch from Firestore.
	 */
	hasCard(cardID: CardID, hotTierCards: Cards, discoveredCards: Cards): boolean {
		return cardID in hotTierCards || cardID in discoveredCards;
	}

	/**
	 * Get all discovered card IDs, sorted by last access time (most recent first).
	 * Used by LRU eviction logic.
	 */
	getDiscoveredCardIDs(): CardID[] {
		const entries = Array.from(this.metadata.entries());
		entries.sort((a, b) => b[1].lastAccessedAt - a[1].lastAccessedAt);
		return entries.map(([cardID]) => cardID);
	}

	/**
	 * Get metadata for a specific card.
	 * Returns undefined if card is not in discovered tier.
	 */
	getMetadata(cardID: CardID): DiscoveredCardMetadata | undefined {
		return this.metadata.get(cardID);
	}

	/**
	 * Remove a card from the discovered tier.
	 * This is called by LRU eviction when the cache is full.
	 */
	removeCard(cardID: CardID): void {
		this.metadata.delete(cardID);
	}

	/**
	 * Remove multiple cards from the discovered tier (batch operation).
	 * Used by LRU eviction for efficiency.
	 */
	removeCards(cardIDs: CardID[]): void {
		for (const cardID of cardIDs) {
			this.metadata.delete(cardID);
		}
	}

	/**
	 * Get the total number of cards in the discovered tier.
	 */
	get size(): number {
		return this.metadata.size;
	}

	/**
	 * Clear all discovered cards.
	 * Used during testing or when resetting the application state.
	 */
	clear(): void {
		this.metadata.clear();
	}
}

// Singleton instance
export const discoveredCardsManager = new DiscoveredCardsManager();

/**
 * Redux thunk action: Discover and fetch a card if it's not in the hot tier.
 *
 * This should be called from the showCard action when a user navigates to a card.
 * It will:
 * 1. Check if card is in hot tier (if so, do nothing)
 * 2. Check if card is already in discovered tier (if so, just update access time)
 * 3. Otherwise, fetch from Firestore and add to discovered tier
 */
export const discoverAndFetchCard = (cardID: CardID, method: DiscoveryMethod = 'navigation'): ThunkSomeAction => async (dispatch, getState) => {
	const state = getState();
	const hotTierCards = state.data.cards;
	const discoveredCards = state.data.discoveredCards || {};

	// If card is in hot tier, we don't need to do anything
	if (cardID in hotTierCards) {
		return;
	}

	// Track this discovery
	discoveredCardsManager.discoverCard(cardID, method);

	// If card is already in discovered tier, just update access time
	if (cardID in discoveredCards) {
		// Access time already updated in discoverCard()
		return;
	}

	// Fetch from Firestore
	const card = await discoveredCardsManager.fetchCard(cardID);

	if (!card) {
		// Card not found or error
		return;
	}

	// Add to Redux state (discovered tier)
	dispatch(receiveCards({ [cardID]: card }, true)); // true = isDiscoveredTier
};

/**
 * Redux thunk action: Discover multiple cards at once.
 *
 * This is used when search results return many cards that might not be in the
 * hot tier. We discover them all but only fetch the ones that will be visible.
 */
export const discoverCards = (cardIDs: CardID[], method: DiscoveryMethod = 'search'): ThunkSomeAction => (dispatch, getState) => {
	const state = getState();
	const hotTierCards = state.data.cards;
	const discoveredCards = state.data.discoveredCards || {};

	for (const cardID of cardIDs) {
		// Skip if in hot tier
		if (cardID in hotTierCards) continue;

		// Track discovery
		discoveredCardsManager.discoverCard(cardID, method);
	}

	// Note: We don't fetch all cards immediately - that would be wasteful.
	// Cards will be fetched on-demand when they're actually viewed or needed.
};
