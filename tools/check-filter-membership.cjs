/* eslint-env node */
/* eslint-disable @typescript-eslint/no-require-imports -- This build guard runs directly as CommonJS. */
// Type-aware boundary guard: opaque card memberships must pass through the
// explicit membership API, rather than accidentally behaving like empty objects.
const ts = require('typescript');
const path = require('node:path');

function inspectMembershipUsage(projectPath) {
	const project = path.resolve(projectPath);
	const loaded = ts.readConfigFile(project, ts.sys.readFile);
	if (loaded.error) throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n'));
	const config = ts.parseJsonConfigFileContent(loaded.config, ts.sys, path.dirname(project));
	if (config.errors.length) throw new Error(config.errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
	const program = ts.createProgram(config.fileNames, {...config.options, noEmit: true});
	const checker = program.getTypeChecker();
	const ownerPath = path.resolve(path.dirname(project), 'shared/filter_membership.ts');
	const owner = program.getSourceFile(ownerPath);
	if (!owner) throw new Error('Membership owner missing from project: ' + ownerPath);
	const ownerSymbol = checker.getSymbolAtLocation(owner);
	const memberSymbols = ownerSymbol ? checker.getExportsOfModule(ownerSymbol).filter(s => ['CardDerivedMembership', 'CardMembershipDomain'].includes(s.name)) : [];
	if (!memberSymbols.some(s => s.name === 'CardDerivedMembership')) throw new Error('CardDerivedMembership export missing');
	const rootPrefix = path.dirname(project) + path.sep;
	const localFiles = new Set(program.getSourceFiles().filter(s => !s.isDeclarationFile && path.resolve(s.fileName).startsWith(rootPrefix) && !s.fileName.includes('/node_modules/')).map(s => path.resolve(s.fileName)));
	const memberTypes = memberSymbols.map(s => checker.getDeclaredTypeOfSymbol(s));
	if (memberTypes.some(t => !t.getProperties().length)) throw new Error('Membership and domain tokens require instance type brands; empty classes accept ordinary objects');
	const directCache = new Map();
	const direct = type => {
		if (directCache.has(type)) return directCache.get(type);
		directCache.set(type, false);
		const constraint = type.flags & ts.TypeFlags.TypeParameter ? checker.getBaseConstraintOfType(type) : undefined;
		const result = memberTypes.includes(type) || memberSymbols.includes(type.getSymbol()) || memberSymbols.includes(type.aliasSymbol) ||
			!!type.types?.some(direct) || !!(constraint && direct(constraint)) ||
			!!(type.flags & ts.TypeFlags.Object && memberTypes.some(memberType => checker.isTypeAssignableTo(type, memberType)));
		directCache.set(type, result);
		return result;
	};
	const localDeclaration = symbol => symbol?.declarations?.some(d => localFiles.has(path.resolve(d.getSourceFile().fileName)));
	const contains = (type, seen = new Set()) => {
		if (direct(type)) return true;
		if (seen.has(type)) return false;
		seen.add(type);
		if (type.types?.some(t => contains(t, seen))) return true;
		// Follow runtime container slots, not arbitrary generic arguments: Pick,
		// Omit and phantom type parameters may have discarded the membership.
		const symbol = type.getSymbol();
		const nativeContainer = ['Map', 'ReadonlyMap', 'Set', 'ReadonlySet'].includes(symbol?.name) &&
			symbol.declarations?.some(d => isNative(d));
		const argumentsOfType = nativeContainer && type.objectFlags & ts.ObjectFlags.Reference ? checker.getTypeArguments(type) : [];
		if (argumentsOfType.some(t => contains(t, seen))) return true;
		for (const index of [type.getStringIndexType?.(), type.getNumberIndexType?.()]) if (index && contains(index, seen)) return true;
		for (const property of type.getProperties()) {
			if (!localDeclaration(property)) continue;
			const declaration = property.valueDeclaration || property.declarations[0];
			if (contains(checker.getTypeOfSymbolAtLocation(property, declaration), seen)) return true;
		}
		return false;
	};
	const diagnostics = [];
	const report = (node, reason) => {
		const source = node.getSourceFile(), point = source.getLineAndCharacterOfPosition(node.getStart(source));
		diagnostics.push({file: source.fileName, line: point.line + 1, column: point.character + 1, reason});
	};
	const objectMethods = new Set(['keys', 'values', 'entries', 'getOwnPropertyNames', 'getOwnPropertySymbols', 'getOwnPropertyDescriptors', 'getOwnPropertyDescriptor', 'hasOwn', 'assign', 'create', 'defineProperty', 'defineProperties', 'setPrototypeOf']);
	const reflected = new Set(['ownKeys', 'get', 'has', 'getOwnPropertyDescriptor', 'set', 'deleteProperty', 'defineProperty']);
	const details = declaration => ({name: declaration?.name?.getText(), parent: (declaration?.parent?.name || declaration?.parent?.parent?.name)?.getText(), declaration});
	const isNative = declaration => {
		const file = declaration?.getSourceFile();
		return !!file?.isDeclarationFile && (/[/\\]typescript[/\\]lib[/\\]lib\.[^/\\]+\.d\.ts$/.test(file.fileName) || /[/\\]@types[/\\]node[/\\]/.test(file.fileName));
	};
	const isObjectOperation = ({name, parent, declaration}) =>
		(isNative(declaration) && ((parent === 'ObjectConstructor' && objectMethods.has(name)) ||
			(parent === 'Reflect' && reflected.has(name)) || (parent === 'Object' && ['hasOwnProperty', 'propertyIsEnumerable'].includes(name)))) ||
		(parent === 'TypedObject' && ['keys', 'values', 'entries'].includes(name));
	const isSerialization = ({name, parent, declaration}) => isNative(declaration) &&
		(['structuredClone', 'postMessage'].includes(name) || (parent === 'JSON' && name === 'stringify'));
	for (const source of program.getSourceFiles()) {
		if (path.resolve(source.fileName) === ownerPath || !localFiles.has(path.resolve(source.fileName))) continue;
		const visit = node => {
			if (ts.isElementAccessExpression(node) && direct(checker.getTypeAtLocation(node.expression))) report(node, 'Use membershipHas instead of bracket lookup');
			if ((ts.isSpreadAssignment(node) || ts.isForInStatement(node)) && direct(checker.getTypeAtLocation(node.expression))) report(node, 'Use membershipKeys or membershipToMap instead of object enumeration');
			if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && contains(checker.getTypeAtLocation(node.expression)) && !contains(checker.getTypeAtLocation(node))) report(node, 'Do not erase membership ownership with a cast');
			if (ts.isVariableDeclaration(node) && node.type && node.initializer && contains(checker.getTypeAtLocation(node.initializer)) && !contains(checker.getTypeAtLocation(node.name))) report(node, 'Do not erase membership ownership with a type annotation');
			if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.InKeyword && direct(checker.getTypeAtLocation(node.right))) report(node, 'Use membershipHas instead of the in operator');
			if (ts.isCallExpression(node)) {
				const resolved = details(checker.getResolvedSignature(node)?.declaration);
				const receiver = ts.isPropertyAccessExpression(node.expression) ? node.expression.expression : undefined;
				const indirect = receiver && ['call', 'apply', 'bind'].includes(node.expression.name.text) ?
					checker.getTypeAtLocation(receiver).getCallSignatures().map(signature => details(signature.declaration)) : [];
				if ((isObjectOperation(resolved) && (node.arguments.some(a => direct(checker.getTypeAtLocation(a))) || !!(receiver && direct(checker.getTypeAtLocation(receiver))))) ||
					(indirect.some(isObjectOperation) && node.arguments.some(a => contains(checker.getTypeAtLocation(a))))) report(node, 'Object operations require explicit membership materialization');
				if ((isSerialization(resolved) && node.arguments[0] && contains(checker.getTypeAtLocation(node.arguments[0]))) ||
					(indirect.some(isSerialization) && node.arguments.slice(1).some(a => contains(checker.getTypeAtLocation(a))))) report(node, 'Materialize memberships into a plain wire DTO before serializing or sending');
			}
			ts.forEachChild(node, visit);
		};
		visit(source);
	}
	return diagnostics;
}

module.exports = {inspectMembershipUsage};
if (require.main === module) {
	try {
		const diagnostics = inspectMembershipUsage(process.argv[2] || 'tsconfig.json');
		for (const d of diagnostics) console.error(`${d.file}:${d.line}:${d.column}: ${d.reason}`);
		if (diagnostics.length) process.exitCode = 1;
		else console.log('Filter membership boundaries verified');
	} catch (error) {console.error(error.message);process.exitCode = 1;}
}
