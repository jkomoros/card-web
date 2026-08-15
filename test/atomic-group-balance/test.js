/*eslint-env node*/

//Guards the bug class that shipped a 100%-broken card-create path: a
//beginAtomicGroup() with no matching endAtomicGroup() before commit(). Every
//commit then throws, and because the durable queue classifies a codeless throw
//as transient, the intent wedges in the replay queue FOREVER — retrying the
//same deterministic failure on every boot while the UI reports the write as
//saved and merely waiting for the connection.
//
//A source-text check rather than a behavioral one, because this bug is
//structural — countable across the WHOLE tree without executing anything, so
//it catches an unbalanced group in code no harness happens to drive.
//
//The original justification also said the executors could not be driven at
//all, since they live in modules that import the browser Firebase runtime.
//That turned out to be wrong: test/card-create-executor and
//test/comment-executors now run the real registered executors against a real
//emulator (see test/harness-support/app-harness.js). Treat this suite as the
//cheap tree-wide net, not as the only coverage — the behavioral tests are the
//stronger instrument where they reach.

import assert from 'assert';
import fs from 'fs';
import path from 'path';

const SRC = path.join(process.cwd(), 'src');

const sourceFiles = (dir) => fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
	const full = path.join(dir, entry.name);
	if (entry.isDirectory()) return sourceFiles(full);
	return entry.name.endsWith('.ts') ? [full] : [];
});

//Scan every DIRECTORY that can hold a MultiBatch caller, not just src/ — the
//admin-SDK MultiBatch in tools/ applies the same policy.
const ROOTS = ['src', 'tools', 'shared'].map(d => path.join(process.cwd(), d)).filter(fs.existsSync);

//Walks a brace-balanced block starting at the first '{' at or after `from`.
const blockFrom = (text, from) => {
	const open = text.indexOf('{', from);
	if (open === -1) return null;
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		if (text[i] === '{') depth++;
		else if (text[i] === '}') {
			depth--;
			if (!depth) return {start: open, end: i + 1, body: text.slice(open, i + 1)};
		}
	}
	return null;
};

//The innermost brace block containing `index`. Using the INNERMOST enclosing
//block rather than a guessed function start means a plain `function foo()`, a
//class method, an arrow, an IIFE and a bare block are all covered — the earlier
//version only recognized `registerAuxWriteExecutor(`, `export const` and
//`const x =`, so a group opened inside a class method was invisible.
const enclosingBlock = (text, index) => {
	let best = null;
	for (let i = 0; i < index; i++) {
		if (text[i] !== '{') continue;
		const block = blockFrom(text, i);
		if (!block || block.end <= index) continue;
		if (!best || block.start > best.start) best = block;
	}
	return best;
};

describe('atomic group balance', () => {
	it('every block that opens an atomic group also closes one', () => {
		const offenders = [];
		for (const root of ROOTS) {
			for (const file of sourceFiles(root)) {
				const text = fs.readFileSync(file, 'utf8');
				let searchFrom = 0;
				for (;;) {
					const at = text.indexOf('.beginAtomicGroup(', searchFrom);
					if (at === -1) break;
					searchFrom = at + 1;
					const block = enclosingBlock(text, at);
					if (!block) continue;
					const begins = (block.body.match(/\.beginAtomicGroup\(/g) || []).length;
					const ends = (block.body.match(/\.endAtomicGroup\(/g) || []).length;
					//An abort closes a group too — the multi-edit loop uses it
					//for the "nothing changed" case.
					const aborts = (block.body.match(/\.abortAtomicGroup\(/g) || []).length;
					if (ends + aborts >= begins) continue;
					const rel = path.relative(process.cwd(), file);
					const line = text.slice(0, at).split('\n').length;
					const entry = `${rel}:${line} — ${begins} begin, ${ends} end, ${aborts} abort`;
					if (!offenders.includes(entry)) offenders.push(entry);
				}
			}
		}
		assert.deepEqual(offenders, [],
			'a group opened and never closed makes every commit throw, and the durable queue then retries that deterministic failure forever');
	});

	it('the card-create executor still opens an atomic group at all', () => {
		//The balance check above passes if you delete BOTH calls — so it cannot
		//see "someone removed atomicity". This pins PRESENCE for the one
		//executor where losing it is silent and permanent: MultiBatch splits at
		//its size limit and commits the parts concurrently with independent
		//success, and the replay preflight only asks whether the CARD exists,
		//so a landed card beside a failed section write leaves the card
		//permanently missing from its section with the intent cleared.
		//
		//This is a source-text pin, which is a weak instrument. The stronger
		//one has since landed: test/card-create-executor drives this executor
		//for real against the emulator, including that its atomic group
		//actually closes. This pin stays as the cheap always-on guard, and
		//because the hole it closes was demonstrated, not theorised.
		const text = fs.readFileSync(path.join(process.cwd(), 'src', 'actions', 'data.ts'), 'utf8');
		const at = text.indexOf(`registerAuxWriteExecutor('card-create'`);
		assert.ok(at > 0, 'the card-create executor must exist');
		const body = blockFrom(text, at);
		assert.ok(body, 'could not read the executor body');
		assert.match(body.body, /\.beginAtomicGroup\(/,
			'card-create must write its card, author, inbound-link, tag and section fanout as ONE atomic group');
		assert.match(body.body, /\.endAtomicGroup\(/);
	});
});
