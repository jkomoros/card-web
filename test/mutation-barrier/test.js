/*eslint-env node*/

import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {describe, it} from 'node:test';
import ts from 'typescript';

import {
	MutationFencedError,
	allowMutations,
	beginMutation,
	fenceMutations,
	inFlightMutationCount,
	mutationsFenced,
	trackMutation,
} from '../../src/mutation-barrier.ts';

describe('Firestore mutation barrier', () => {
	it('tracks a mutation for its complete asynchronous lifetime', async () => {
		allowMutations();
		let resolve;
		const pending = trackMutation(() => new Promise(done => { resolve = done; }));
		assert.equal(inFlightMutationCount(), 1);
		resolve('done');
		assert.equal(await pending, 'done');
		assert.equal(inFlightMutationCount(), 0);
	});

	it('settles accounting after rejection or synchronous throw', async () => {
		allowMutations();
		await assert.rejects(trackMutation(() => Promise.reject(new Error('async failure'))), /async failure/);
		assert.equal(inFlightMutationCount(), 0);
		await assert.rejects(trackMutation(() => { throw new Error('sync failure'); }), /sync failure/);
		assert.equal(inFlightMutationCount(), 0);
	});

	it('checks the fence before invoking the write operation', async () => {
		fenceMutations();
		let invoked = false;
		await assert.rejects(
			trackMutation(async () => { invoked = true; }),
			MutationFencedError,
		);
		assert.equal(invoked, false);
		assert.equal(inFlightMutationCount(), 0);
		assert.equal(mutationsFenced(), true);
		allowMutations();
	});

	it('returns an idempotent completion callback', () => {
		allowMutations();
		const finish = beginMutation();
		assert.equal(inFlightMutationCount(), 1);
		finish();
		finish();
		assert.equal(inFlightMutationCount(), 0);
	});
});

const sourceFilesUnder = async directory => {
	const entries = await readdir(directory, {withFileTypes: true});
	const nested = await Promise.all(entries.map(entry => {
		const target = path.join(directory, entry.name);
		if (entry.isDirectory()) return sourceFilesUnder(target);
		return entry.isFile() && target.endsWith('.ts') ? [target] : [];
	}));
	return nested.flat();
};

describe('raw Firestore write coverage', () => {
	it('requires every raw write primitive to run inside trackMutation', async () => {
		const root = path.resolve('src');
		const violations = [];
		for (const filename of await sourceFilesUnder(root)) {
			const sourceText = await readFile(filename, 'utf8');
			const source = ts.createSourceFile(filename, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
			const inspect = node => {
				if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
					const primitive = node.expression.text;
					if (primitive === 'writeBatch') {
						if (!filename.endsWith(path.join('src', 'multi_batch.ts'))) violations.push(`${path.relative(root, filename)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${primitive}`);
					} else if (['setDoc', 'updateDoc', 'deleteDoc', 'runTransaction'].includes(primitive)) {
						const arrow = node.parent;
						const wrapper = arrow && ts.isArrowFunction(arrow) && arrow.body === node ? arrow.parent : null;
						const tracked = wrapper && ts.isCallExpression(wrapper) && ts.isIdentifier(wrapper.expression) && wrapper.expression.text === 'trackMutation';
						if (!tracked) violations.push(`${path.relative(root, filename)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${primitive}`);
					}
				}
				ts.forEachChild(node, inspect);
			};
			inspect(source);
		}
		assert.deepEqual(violations, []);
	});
});
