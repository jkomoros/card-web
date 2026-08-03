/*eslint-env node, es2022*/

//Aggregate a V8 heap snapshot by constructor: count and total self_size per
//(type, name). Answers "what is this heap actually made of", which sampling
//`Runtime.getHeapUsage` cannot.
//
//  node --max-old-space-size=6144 tools/heap-snapshot-report.mjs <file> [topN]
//
//Capture the input with tools/capture-heap-snapshot.mjs, or from DevTools
//(Memory -> Heap snapshot -> Save). Expect ~3.5x the heap size on disk: a
//230MB heap produces an ~830MB file.
//
//Why this streams rather than JSON.parse: the file exceeds V8's maximum string
//length, and `strings` -- which node names index into -- is the LAST section,
//so name resolution needs a second pass after the aggregate is known.
import fs from 'fs';

const path = process.argv[2];
const TOP = Number(process.argv[3] || 40);

//The header is small and sits at the front, so a bounded read is enough to
//learn the field layout rather than assuming it.
const head = await new Promise(resolve => {
	const stream = fs.createReadStream(path, {start: 0, end: 65535, encoding: 'utf8'});
	let buf = '';
	stream.on('data', c => { buf += c; });
	stream.on('end', () => resolve(buf));
});
const metaMatch = head.match(/"node_fields":\[(.*?)\]/);
const typesMatch = head.match(/"node_types":\[\[(.*?)\]/);
const fields = metaMatch[1].split(',').map(s => s.replace(/"/g, ''));
const nodeTypes = typesMatch[1].split(',').map(s => s.replace(/"/g, ''));
const FIELD_COUNT = fields.length;
const TYPE_IDX = fields.indexOf('type');
const NAME_IDX = fields.indexOf('name');
const SIZE_IDX = fields.indexOf('self_size');
console.log(`node_fields = ${fields.join(',')}`);

//Scan a flat integer array that begins after `marker`, calling onValue for each
//number, until the closing bracket. Chunk-boundary safe: a partial number is
//carried over.
const scanIntArray = (marker, onValue) => new Promise((resolve, reject) => {
	const stream = fs.createReadStream(path, {encoding: 'utf8'});
	let started = false, done = false, carry = '', pending = '';
	stream.on('data', chunk => {
		if (done) return;
		let text = chunk;
		if (!started) {
			const at = (carry + text).indexOf(marker);
			if (at === -1) { carry = (carry + text).slice(-marker.length); return; }
			text = (carry + text).slice(at + marker.length);
			started = true; carry = '';
		}
		const end = text.indexOf(']');
		if (end !== -1) { text = text.slice(0, end); done = true; }
		const parts = (pending + text).split(',');
		pending = done ? '' : parts.pop();
		for (const part of parts) if (part.length) onValue(Number(part));
		if (done) { if (pending.length) onValue(Number(pending)); stream.destroy(); resolve(); }
	});
	stream.on('close', () => { if (!done) resolve(); });
	stream.on('error', reject);
});

//Pass 1.
const agg = new Map();
let field = 0, type = 0, name = 0, nodeCount = 0, totalSize = 0;
await scanIntArray('"nodes":[', value => {
	if (field === TYPE_IDX) type = value;
	else if (field === NAME_IDX) name = value;
	else if (field === SIZE_IDX) {
		const key = type * 4294967296 + name;
		const entry = agg.get(key);
		if (entry) { entry.count++; entry.size += value; }
		else agg.set(key, {count: 1, size: value, type, name});
		nodeCount++; totalSize += value;
	}
	field = (field + 1) % FIELD_COUNT;
});
console.log(`nodes = ${nodeCount.toLocaleString()}, total self_size = ${Math.round(totalSize / 1048576)}MB`);

const top = [...agg.values()].sort((a, b) => b.size - a.size).slice(0, TOP);
const wanted = new Set(top.map(e => e.name));

//Pass 2: resolve just the names we need.
const names = new Map();
let index = 0, inString = false, escaped = false, current = '', startedStrings = false, finished = false;
await new Promise((resolve, reject) => {
	const stream = fs.createReadStream(path, {encoding: 'utf8'});
	let carry = '';
	stream.on('data', chunk => {
		if (finished) return;
		let text = chunk;
		if (!startedStrings) {
			const at = (carry + text).indexOf('"strings":[');
			if (at === -1) { carry = (carry + text).slice(-16); return; }
			text = (carry + text).slice(at + '"strings":['.length);
			startedStrings = true; carry = '';
		}
		for (let i = 0; i < text.length; i++) {
			const ch = text[i];
			if (inString) {
				if (escaped) { current += ch; escaped = false; }
				else if (ch === '\\') { escaped = true; }
				else if (ch === '"') {
					inString = false;
					if (wanted.has(index)) names.set(index, current);
					index++; current = '';
					if (index > Math.max(...wanted) ) { finished = true; stream.destroy(); resolve(); return; }
				} else current += ch;
			} else if (ch === '"') { inString = true; current = ''; }
			else if (ch === ']') { finished = true; stream.destroy(); resolve(); return; }
		}
	});
	stream.on('close', () => { if (!finished) resolve(); });
	stream.on('error', reject);
});

console.log(`\n${'TYPE'.padEnd(14)}${'NAME'.padEnd(42)}${'COUNT'.padStart(12)}${'SELF MB'.padStart(10)}`);
for (const entry of top) {
	console.log(
		(nodeTypes[entry.type] || String(entry.type)).padEnd(14) +
		(names.get(entry.name) || `#${entry.name}`).slice(0, 40).padEnd(42) +
		entry.count.toLocaleString().padStart(12) +
		(entry.size / 1048576).toFixed(1).padStart(10));
}
