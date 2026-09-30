import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import adapterStaticExtension, { runPostBuildScript } from './index.js';

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

for (const fixture of [
	{ name: 'shared directories', options: { pages: 'extension', assets: 'extension' } },
	{ name: 'separate directories', options: { pages: 'pages', assets: 'assets' } },
	{ name: 'default directories', options: {} },
	{ name: 'assets defaulting to pages', options: { pages: 'extension' } },
	{
		name: 'Firefox options and a custom build script',
		options: {
			firefox: {
				apiReplacements: [{ find: 'chrome.exampleApi', replace: 'browser.exampleApi' }]
			},
			firefoxBuildScript: 'build-mozilla'
		}
	},
	{ name: 'the environment flag', options: {}, useEnvFlag: true },
	{ name: 'disabled Firefox support', options: { firefox: false } },
	{ name: 'disabled splitting', options: { splitBuilds: false } },
	{ name: 'splitting disabled by default', options: { splitBuilds: undefined } }
]) {
	test(`splitBuilds handles ${fixture.name}`, async (t) => {
		const outputDir = createOutputDir();
		const originalCwd = process.cwd();
		const originalEnv = {
			npm_lifecycle_event: process.env.npm_lifecycle_event,
			ADAPTER_EXTENSION_FIREFOX: process.env.ADAPTER_EXTENSION_FIREFOX
		};

		t.after(() => {
			process.chdir(originalCwd);
			for (const [key, value] of Object.entries(originalEnv)) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
			fs.rmSync(outputDir, { recursive: true, force: true });
		});

		process.chdir(outputDir);
		delete process.env.ADAPTER_EXTENSION_FIREFOX;
		const options = { firefox: true, splitBuilds: true, ...fixture.options };
		const adapter = adapterStaticExtension(options);
		const pages = options.pages || 'build';
		const assets = options.assets || pages;
		const split = options.splitBuilds && options.firefox;
		const expectedDestinations = split
			? [assets, pages, `${assets}-firefox`, `${pages}-firefox`]
			: [assets, pages];
		const destinations = [];
		const workerSource = 'el.innerHTML = html; chrome.exampleApi();';
		const builder = {
			config: { kit: { router: { type: 'hash' } } },
			log: t.mock.fn(),
			rimraf: (dir) => fs.rmSync(dir, { recursive: true, force: true }),
			generateEnvModule: () => {},
			writeClient: (dir) => {
				destinations.push(dir);
				writeBuild(dir, { 'asset.txt': 'fixture' });
			},
			writePrerendered: (dir) => {
				destinations.push(dir);
				writeBuild(dir, {
					'index.html': sveltePage({ title: 'Home', nodeIds: [0, 2], hashed: false }),
					'worker.js': workerSource,
					'manifest.json': JSON.stringify({
						name: 'Fixture',
						version: '1.0.0',
						manifest_version: 3,
						background: { service_worker: 'worker.js' },
						browser_specific_settings: {
							gecko: {
								id: 'fixture@example.com',
								data_collection_permissions: { required: ['none'] }
							}
						}
					})
				});
			}
		};

		process.env.npm_lifecycle_event = 'build';
		await adapter.adapt(builder);
		assert.deepEqual(destinations.splice(0), expectedDestinations);
		const chromeManifest = read(pages, 'manifest.json');
		assert.equal(JSON.parse(chromeManifest).background.service_worker, 'worker.js');
		assert.equal(read(pages, 'worker.js'), workerSource);
		if (split) {
			const manifest = JSON.parse(read(`${pages}-firefox`, 'manifest.json'));
			assert.deepEqual(manifest.background, { scripts: ['worker.js'] });
			assert.match(read(`${pages}-firefox`, 'worker.js'), /el\["innerHTML"\] = html/);
			if (options.firefox.apiReplacements) {
				assert.match(read(`${pages}-firefox`, 'worker.js'), /browser\.exampleApi/);
			}
			writeBuild(`${pages}-firefox`, { 'stale.txt': 'old build' });
			writeBuild(`${assets}-firefox`, { 'stale-asset.txt': 'old asset' });
		}

		process.env.npm_lifecycle_event = fixture.useEnvFlag
			? 'build'
			: options.firefoxBuildScript || 'build-firefox';
		if (fixture.useEnvFlag) process.env.ADAPTER_EXTENSION_FIREFOX = '1';
		await adapter.adapt(builder);

		const suffix = split ? '-firefox' : '';
		assert.deepEqual(destinations, expectedDestinations);
		assert.equal(read(`${assets}${suffix}`, 'asset.txt'), 'fixture');
		assert.equal(nonEmptyInlineScripts(read(`${pages}${suffix}`, 'index.html')).length, 0);
		assert.match(read(`${pages}${suffix}`, 'scripts/init.js'), /globalThis\.__sveltekit_abc123/);
		const manifest = JSON.parse(read(`${pages}${suffix}`, 'manifest.json'));
		if (options.firefox) assert.deepEqual(manifest.background, { scripts: ['worker.js'] });
		else assert.equal(manifest.background.service_worker, 'worker.js');
		if (split) {
			assert.equal(read(pages, 'manifest.json'), chromeManifest);
			assert.equal(read(pages, 'worker.js'), workerSource);
			assert.equal(fs.existsSync(path.join(`${pages}-firefox`, 'stale.txt')), false);
			assert.equal(fs.existsSync(path.join(`${assets}-firefox`, 'stale-asset.txt')), false);
			const patched = { ...JSON.parse(chromeManifest), key: 'development-key' };
			writeBuild(pages, { 'manifest.json': JSON.stringify(patched) });
			assert.equal(JSON.parse(read(`${pages}-firefox`, 'manifest.json')).key, undefined);
		}
	});
}
