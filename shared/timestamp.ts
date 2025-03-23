/**
 * A type definition for Firestore Timestamp that works with both
 * firebase/firestore and firebase-admin/firestore implementations.
 * 
 * This interface only describes the shape and does not provide an implementation.
 * 
 * Use this type when you need to work with timestamps in code shared between
 * client and server.
 */

export interface Timestamp {
	/** Timestamp seconds since Unix epoch */
	readonly seconds: number;
	
	/** Timestamp nanoseconds (between 0 and 999,999,999) */
	readonly nanoseconds: number;
	
	/** Converts the timestamp to a JavaScript Date object */
	toDate(): Date;
	
	/** Converts the timestamp to milliseconds since epoch */
	toMillis(): number;
	
	/** Returns true if this timestamp is equal to the provided timestamp */
	isEqual(other: Timestamp): boolean;
	
	/** Returns a string representation of this timestamp */
	toString(): string;
	
	/** 
	 * Returns an object representation of this timestamp 
	 * that will be serialized to seconds and nanoseconds
	 */
	toJSON(): { seconds: number; nanoseconds: number };
}

/**
 * The constructor interface for Firestore Timestamp
 */
export interface TimestampConstructor {
	/** Creates a new timestamp with the given seconds and nanoseconds */
	new(seconds: number, nanoseconds: number): Timestamp;
	
	/** Returns a timestamp representing the current moment */
	now(): Timestamp;
	
	/** Creates a new timestamp from a JavaScript Date object */
	fromDate(date: Date): Timestamp;
	
	/** Creates a new timestamp from milliseconds since epoch */
	fromMillis(milliseconds: number): Timestamp;
}