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
		console.log('Using cached IDF map (version:', cached.data.version, ')');
		return cached.data;
	}

	if (cached) {
		console.log('Cached IDF expired, re-downloading...');
	}

	// Download from Cloud Storage
	try {
		const idfData = await downloadIDFMap();
		if (idfData) {
			cacheIDF(idfData);
			console.log('Downloaded and cached IDF map (version:', idfData.version, ')');
		}
		return idfData;
	} catch (error) {
		console.warn('Failed to download server IDF map, falling back to client-side calculation:', error);
		return null;
	}
};

/**
 * Downloads IDF map from Cloud Storage.
 */
const downloadIDFMap = async (): Promise<ServerIDFData | null> => {
	try {
		// Determine the Firebase project bucket
		const bucketName = getStorageBucketName();
		const url = `https://storage.googleapis.com/${bucketName}/idf-maps/latest.json`;

		console.log('Downloading IDF map from:', url);

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
		console.error('Error downloading IDF map:', error);
		return null;
	}
};

/**
 * Gets the Firebase Storage bucket name based on the current environment.
 */
const getStorageBucketName = (): string => {
	// Check hostname to determine environment
	const hostname = window.location.hostname;

	if (hostname.includes('localhost') || hostname.includes('dev-complexity-compendium')) {
		return 'dev-complexity-compendium.appspot.com';
	}

	return 'complexity-compendium.appspot.com';
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
	// Check cache version
	if (cached.version !== CACHE_VERSION) {
		console.log('Cache version mismatch, invalidating');
		return false;
	}

	// Check TTL
	const age = Date.now() - cached.cachedAt;
	if (age > CACHE_TTL_MS) {
		console.log('Cache expired (age:', Math.round(age / 1000 / 60 / 60), 'hours)');
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
		console.log('Cached IDF map in localStorage');
	} catch (error) {
		console.warn('Failed to cache IDF map (localStorage may be full):', error);
	}
};

/**
 * Clears the IDF cache. Useful for debugging.
 */
export const clearIDFCache = (): void => {
	try {
		localStorage.removeItem(CACHE_KEY);
		console.log('Cleared IDF cache');
	} catch (error) {
		console.warn('Failed to clear IDF cache:', error);
	}
};
