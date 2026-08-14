/*eslint-env node*/

//THE BRANCH'S MOST-RECURRENT BUG, finally owned by a test instead of a reviewer.
//
//In Lit, a field only triggers a re-render if it carries its own @state() or
//@property() decorator. TypeScript's field syntax makes it very easy to write
//
//    @state()
//        _first: boolean;
//        _second: boolean;   // <- NOT decorated; looks like it is
//
//and the result is an almost-correct component: assigning `_second` schedules
//no update, so it renders correctly only when something ELSE happens to
//re-render nearby. During boot that is frequent, which is why every occurrence
//has looked like it worked.
//
//Found and swept in Round 13 (four components), again in Round 14
//(_suggestedTagsState), and AGAIN in Round 18 (_collectionPending) — in the very
//commit that fixed the previous round's polish item. Two "fixed everywhere"
//sweeps did not hold, because nothing enforced it between reviews.
//
//The rule: every field a component assigns in stateChanged() must have its own
//reactive decorator. stateChanged is where Redux state becomes component state,
//so a field written there and not declared reactive is, by construction, a
//value the UI is expected to show and will not re-render for.

import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {describe, it} from 'node:test';
import ts from 'typescript';

const COMPONENTS_DIR = path.join(process.cwd(), 'src', 'components');

//NO EXEMPTION LIST, deliberately. The rule flags a field only when it is BOTH
//assigned in stateChanged AND read by the template — which is exactly the
//combination that renders stale, and never true of the cache keys, timers and
//bookkeeping that are correctly plain. An earlier version flagged every
//undecorated field written in stateChanged; it found six, all six turned out to
//be legitimate, and it would have needed a growing list of excuses — which is
//where a rule goes to die.
const reactiveDecorators = new Set(['state', 'property']);

const hasOwnReactiveDecorator = (member) => {
	const decorators = ts.canHaveDecorators?.(member) ? ts.getDecorators(member) : member.decorators;
	if (!decorators) return false;
	return decorators.some(decorator => {
		const call = decorator.expression;
		if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) return false;
		return reactiveDecorators.has(call.expression.text);
	});
};

describe('components re-render for the state they derive from Redux', () => {

	it('every field assigned in stateChanged carries its own @state/@property', async () => {
		const files = (await readdir(COMPONENTS_DIR)).filter(name => name.endsWith('.ts'));
		assert.ok(files.length > 10, 'expected to find the component directory');
		const violations = [];

		for (const filename of files) {
			const sourceText = await readFile(path.join(COMPONENTS_DIR, filename), 'utf8');
			const source = ts.createSourceFile(filename, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

			const walkClass = (classNode) => {
				const declared = new Map();
				for (const member of classNode.members) {
					if (!ts.isPropertyDeclaration(member) || !ts.isIdentifier(member.name)) continue;
					declared.set(member.name.text, hasOwnReactiveDecorator(member));
				}

				const stateChanged = classNode.members.find(member =>
					ts.isMethodDeclaration(member) && ts.isIdentifier(member.name) && member.name.text === 'stateChanged');
				if (!stateChanged) return;

				const assigned = new Set();
				const visit = (node) => {
					if (ts.isBinaryExpression(node) &&
						node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
						ts.isPropertyAccessExpression(node.left) &&
						node.left.expression.kind === ts.SyntaxKind.ThisKeyword &&
						ts.isIdentifier(node.left.name)) {
						assigned.add(node.left.name.text);
					}
					ts.forEachChild(node, visit);
				};
				visit(stateChanged);

				//Read by the template: render(), or any getter, since Lit
				//templates commonly pull values through accessors.
				const renderedFields = new Set();
				for (const member of classNode.members) {
					const isRender = ts.isMethodDeclaration(member) && ts.isIdentifier(member.name) && member.name.text === 'render';
					if (!isRender && !ts.isGetAccessor(member)) continue;
					const collect = (node) => {
						if (ts.isPropertyAccessExpression(node) &&
							node.expression.kind === ts.SyntaxKind.ThisKeyword &&
							ts.isIdentifier(node.name)) {
							renderedFields.add(node.name.text);
						}
						ts.forEachChild(node, collect);
					};
					collect(member);
				}

				for (const field of assigned) {
					if (!declared.has(field)) continue;
					if (declared.get(field)) continue;
					if (!renderedFields.has(field)) continue;
					violations.push(`${filename}: this.${field} is assigned in stateChanged AND read by the template, but has no @state()/@property() of its own`);
				}
			};

			const visitTop = (node) => {
				if (ts.isClassDeclaration(node)) walkClass(node);
				ts.forEachChild(node, visitTop);
			};
			visitTop(source);
		}

		assert.deepEqual(violations, [],
			'these fields will not re-render when they change:\n  ' + violations.join('\n  '));
	});

	it('actually looks at the components (guards against a vacuous pass)', async () => {
		//A rule that silently parses nothing passes forever. Assert it found the
		//shape it depends on: a component with a decorated field and a
		//stateChanged method.
		const text = await readFile(path.join(COMPONENTS_DIR, 'card-view.ts'), 'utf8');
		assert.ok(text.includes('@state()'), 'expected decorated fields to exist');
		assert.ok(text.includes('stateChanged'), 'expected a stateChanged method to exist');
	});
});
