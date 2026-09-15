import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runPostBuildScript } from './index.js';

const hashedJs = 'bundle.D4n8xY1.js';
const hashedCss = 'bundle.C7a2bX2.css';

function createOutputDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-extension-'));
}

function writeBuild(outputDir, files) {
	for (const [relativePath, contents] of Object.entries(files)) {
		const filePath = path.join(outputDir, relativePath);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, contents);
	}
}

function read(outputDir, relativePath) {
	return fs.readFileSync(path.join(outputDir, relativePath), 'utf-8');
}

function sveltePage({ title, nodeIds, extraScripts = '', hashed = true }) {
	const jsRef = hashed ? hashedJs : 'bundle.js';
	const cssRef = hashed ? hashedCss : 'style.css';

	return `<!DOCTYPE html>
<html lang="en">
	<head>
		<title>${title}</title>
		<link href="././scripts/immutable/assets/${cssRef}" rel="stylesheet">
		<link rel="modulepreload" href="././scripts/immutable/${jsRef}">
	</head>
	<body>
		<div style="display: contents">${title}</div>
		<script>
			{
				__sveltekit_abc123 = {
					base: new URL(".", location).pathname.slice(0, -1)
				};

				const element = document.currentScript.parentElement;

				Promise.all([
					import("././scripts/immutable/${jsRef}")
				]).then(([app]) => {
					app.start(element, {
						node_ids: ${JSON.stringify(nodeIds)},
						data: [null,null],
						form: null,
						error: null
					});
				});
			}
		</script>${extraScripts}
	</body>
</html>
`;
}

function nonEmptyInlineScripts(html) {
	return [...html.matchAll(/<script(\b[^>]*)>([\s\S]*?)<\/script>/gi)].filter(
		(match) => !/\bsrc\s*=/i.test(match[1] || '') && match[2].trim()
	);
}

function hashedAssetRefs(html) {
	return html.match(/bundle\.[A-Za-z0-9_-]+\.(js|css)/g) ?? [];
}

test('single-page fixture writes scripts/init.js and removes the index inline script', async () => {
	const outputDir = createOutputDir();

	try {
		writeBuild(outputDir, {
			[`scripts/immutable/${hashedJs}`]: 'export function start() {}',
			[`scripts/immutable/assets/${hashedCss}`]: 'body { color: black; }',
			'index.html': sveltePage({ title: 'Home', nodeIds: [0, 2] })
		});

		await runPostBuildScript(outputDir);

		const html = read(outputDir, 'index.html');
		const initJs = read(outputDir, 'scripts/init.js');

		assert.equal(fs.existsSync(path.join(outputDir, 'scripts/immutable/bundle.js')), true);
		assert.equal(fs.existsSync(path.join(outputDir, 'scripts/immutable/assets/style.css')), true);
		assert.equal(nonEmptyInlineScripts(html).length, 0);
		assert.match(html, /<script src="\.\/\.\/scripts\/init\.js" type="module"><\/script>/);
		assert.equal(hashedAssetRefs(html).length, 0);
		assert.match(initJs, /globalThis\.__sveltekit_abc123 =/);
		assert.match(initJs, /document\.body\.querySelector\('div\[style\*="display: contents"\]'\)/);
		assert.match(initJs, /import\("\.\/immutable\/bundle\.js"\)/);
		assert.match(initJs, /node_ids: \[0,2\]/);
		assert.doesNotMatch(initJs, /document\.currentScript\.parentElement/);
		assert.doesNotMatch(initJs, /scripts\/immutable\/bundle/);
	} finally {
		fs.rmSync(outputDir, { recursive: true, force: true });
	}
});

test('multi-page fixture extracts each page script and preserves node_ids', async () => {
	const outputDir = createOutputDir();

	try {
		writeBuild(outputDir, {
			[`scripts/immutable/${hashedJs}`]: 'export function start() {}',
			[`scripts/immutable/assets/${hashedCss}`]: 'body { color: black; }',
			'index.html': sveltePage({ title: 'Home', nodeIds: [0, 2] }),
			'calendar.html': sveltePage({ title: 'Calendar', nodeIds: [0, 4] }),
			'settings.html': sveltePage({ title: 'Settings', nodeIds: [0, 6] })
		});

		await runPostBuildScript(outputDir);

		const pages = [
			['index.html', 'scripts/init.js', [0, 2]],
			['calendar.html', 'scripts/start-calendar.js', [0, 4]],
			['settings.html', 'scripts/start-settings.js', [0, 6]]
		];

		for (const [htmlFile, scriptFile, nodeIds] of pages) {
			const html = read(outputDir, htmlFile);
			const script = read(outputDir, scriptFile);

			assert.equal(nonEmptyInlineScripts(html).length, 0, htmlFile);
			assert.equal(hashedAssetRefs(html).length, 0, htmlFile);
			assert.match(html, /scripts\/immutable\/assets\/style\.css/);
			assert.match(html, /scripts\/immutable\/bundle\.js/);
			assert.match(script, new RegExp(`node_ids: \\[${nodeIds.join(',')}\\]`));
			assert.match(script, /globalThis\.__sveltekit_abc123 =/);
			assert.match(script, /import\("\.\/immutable\/bundle\.js"\)/);
		}

		const calendar = read(outputDir, 'scripts/start-calendar.js');
		const settings = read(outputDir, 'scripts/start-settings.js');
		assert.doesNotMatch(calendar, /node_ids: \[0,2\]/);
		assert.doesNotMatch(settings, /node_ids: \[0,2\]/);
		assert.match(read(outputDir, 'calendar.html'), /src="\.\/\.\/scripts\/start-calendar\.js"/);
	} finally {
		fs.rmSync(outputDir, { recursive: true, force: true });
	}
});

test('suffixes extracted scripts when a page has multiple inline scripts', async () => {
	const outputDir = createOutputDir();

	try {
		writeBuild(outputDir, {
			[`scripts/immutable/${hashedJs}`]: 'export function start() {}',
			'calendar.html': sveltePage({
				title: 'Calendar',
				nodeIds: [0, 4],
				extraScripts: `
		<script>
			window.adapterExtensionExtra = 1;
		</script>`
			})
		});

		await runPostBuildScript(outputDir);

		const html = read(outputDir, 'calendar.html');
		assert.equal(nonEmptyInlineScripts(html).length, 0);
		assert.match(read(outputDir, 'scripts/start-calendar-1.js'), /node_ids: \[0,4\]/);
		assert.match(read(outputDir, 'scripts/start-calendar-2.js'), /window\.adapterExtensionExtra = 1;/);
		assert.equal(fs.existsSync(path.join(outputDir, 'scripts/start-calendar.js')), false);
	} finally {
		fs.rmSync(outputDir, { recursive: true, force: true });
	}
});

test('skips empty inline scripts and leaves existing src scripts in place', async () => {
	const outputDir = createOutputDir();

	try {
		writeBuild(outputDir, {
			[`scripts/immutable/${hashedJs}`]: 'export function start() {}',
			'about.html': `<!DOCTYPE html>
<html>
	<body>
		<script src="././scripts/immutable/${hashedJs}" type="module"></script>
		<script>   </script>
		<script></script>
	</body>
</html>
`
		});

		await runPostBuildScript(outputDir);

		const html = read(outputDir, 'about.html');
		assert.match(html, /<script src="\.\/\.\/scripts\/immutable\/bundle\.js" type="module"><\/script>/);
		assert.match(html, /<script> {3}<\/script>/);
		assert.match(html, /<script><\/script>/);
		assert.equal(fs.existsSync(path.join(outputDir, 'scripts/start-about.js')), false);
		assert.equal(fs.existsSync(path.join(outputDir, 'scripts/init.js')), false);
	} finally {
		fs.rmSync(outputDir, { recursive: true, force: true });
	}
});
