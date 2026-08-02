/*eslint-env node*/

//Guards the bug class that shipped a 100%-broken card-create path: a
//beginAtomicGroup() with no matching endAtomicGroup() before commit(). Every
//commit then throws, and because the durable queue classifies a codeless throw
//as transient, the intent wedges in the replay queue FOREVER — retrying the
//same deterministic failure on every boot while the UI reports the write as
//saved and merely waiting for the connection.
//
//A source-text check rather than a behavioral one, deliberately: the executors
//live in modules that import the browser Firebase runtime, and this bug is
//structural — countable without executing anything.

import assert from 'assert';
import fs from 'fs';
import path from 'path';

const SRC = path.join(process.cwd(), 'src');

const sourceFiles = (dir) => fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
	const full = path.join(dir, entry.name);
	if (entry.isDirectory()) return sourceFiles(full);
	return entry.name.endsWith('.ts') ? [full] : [];
});

//Walks a function body by brace depth from a starting index, returning its text.
const bodyFrom = (text, startIndex) => {
	const open = text.indexOf('{', startIndex);
	if (open === -1) return '';
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		if (text[i] === '{') depth++;
		else if (text[i] === '}') {
			depth--;
			if (!depth) return text.slice(open, i + 1);
		}
	}
	return text.slice(open);
};

describe('atomic group balance', () => {
	it('every function that opens an atomic group also closes one', () => {
		const offenders = [];
		for (const file of sourceFiles(SRC)) {
			const text = fs.readFileSync(file, 'utf8');
			if (!text.includes('beginAtomicGroup')) continue;
			//Check per enclosing function, not per file: a file can legitimately
			//have several, and a count that only balances across the whole file
			//is exactly how this bug hid.
			const re = /(registerAuxWriteExecutor\([^\n]*|export const \w+|const \w+ = )/g;
			let m;
			const starts = [];
			while ((m = re.exec(text))) starts.push(m.index);
			for (let i = 0; i < starts.length; i++) {
				const body = bodyFrom(text, starts[i]);
				const begins = (body.match(/\.beginAtomicGroup\(/g) || []).length;
				if (!begins) continue;
				const ends = (body.match(/\.endAtomicGroup\(/g) || []).length;
				const aborts = (body.match(/\.abortAtomicGroup\(/g) || []).length;
				//An abort closes a group too — the multi-edit loop uses it for
				//the "nothing changed" case.
				if (ends + aborts < begins) {
					offenders.push(`${path.relative(process.cwd(), file)}: ${begins} begin, ${ends} end, ${aborts} abort — near ${text.slice(starts[i], starts[i] + 70).split('\n')[0]}`);
				}
			}
		}
		assert.deepEqual(offenders, [],
			'a group opened and never closed makes every commit throw, and the durable queue then retries that deterministic failure forever');
	});
});
