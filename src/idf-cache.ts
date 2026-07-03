import { ref, getDownloadURL } from 'firebase/storage';
import { storage } from './firebase.js';
import { ServerIDFData } from './types.js';

const CACHE_KEY = 'server_idf_cache';
const CACHE_VERSION = 1; // Increment to force cache invalidation
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

type CachedIDF = {
	version: number,
	cachedAt: number,
	data: ServerIDFData
};

/**
 * Main entry point to load server IDF map.
 * Checks cache first, then downloads if needed.
 * Returns null if download fails (graceful 404 fallback).
 */
export const loadServerIDF = async (): Promise<ServerIDFData | null> => {
	// Try cache first
	const cached = getCachedIDF();
	if (cached && isCacheValid(cached)) {
		return cached.data;
	}

	// Download from Cloud Storage
	try {
		const idfData = await downloadIDFMap();
		if (idfData) {
			cacheIDF(idfData);
		}
		return idfData;
	} catch (error) {
		console.warn('Failed to download server IDF map, falling back to client-side calculation:', error);
		return null;
	}
};

/**
 * Downloads IDF map from Cloud Storage using Firebase Storage SDK.
 */
const downloadIDFMap = async (): Promise<ServerIDFData | null> => {
	try {
		const idfRef = ref(storage, 'idf-maps/latest.json');
		const url = await getDownloadURL(idfRef);
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const data = await response.json() as ServerIDFData;

		// Validate structure
		if (!data || typeof data.version !== 'number' || !data.idf || typeof data.maxIDF !== 'number') {
			throw new Error('Invalid IDF data structure');
		}

		return data;
	} catch (error) {
		console.warn('Error downloading IDF map:', error);
		return null;
	}
};

/**
 * Gets cached IDF from localStorage.
 */
const getCachedIDF = (): CachedIDF | null => {
	try {
		const cached = localStorage.getItem(CACHE_KEY);
		if (!cached) return null;

		const parsed = JSON.parse(cached) as CachedIDF;
		return parsed;
	} catch (error) {
		console.warn('Failed to read IDF cache:', error);
		return null;
	}
};

/**
 * Checks if cached IDF is still valid.
 */
const isCacheValid = (cached: CachedIDF): boolean => {
	if (cached.version !== CACHE_VERSION) {
		return false;
	}

	const age = Date.now() - cached.cachedAt;
	if (age > CACHE_TTL_MS) {
		return false;
	}

	return true;
};

/**
 * Stores IDF data in localStorage.
 */
const cacheIDF = (data: ServerIDFData): void => {
	try {
		const cached: CachedIDF = {
			version: CACHE_VERSION,
			cachedAt: Date.now(),
			data
		};
		localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
	} catch (error) {
		console.warn('Failed to cache IDF map (localStorage may be full):', error);
	}
};

