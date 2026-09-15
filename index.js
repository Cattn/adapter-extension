import fs from 'fs';
import path from 'path';
import adapterStatic from '@sveltejs/adapter-static';
import { applyFirefoxSupport } from './firefox.js';

function toPosix(filePath) {
	return filePath.replaceAll('\\', '/');
}

function findHtmlFiles(dir) {
	if (!fs.existsSync(dir)) return [];

	const results = [];

	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const fullPath = path.join(dir, entry.name);

		if (entry.isDirectory()) {
			results.push(...findHtmlFiles(fullPath));
		} else if (entry.isFile() && entry.name.endsWith('.html')) {
			results.push(fullPath);
		}
	}

	return results;
}

function applyRenames(html, renames) {
	for (const { old, new: newPath } of renames) {
		html = html.replaceAll(old, newPath);
	}

	return html;
}

function transformInlineScript(source) {
	let script = source;

	script = script.replace(/(?<!globalThis\.)(__sveltekit_\w+)\s*=/g, 'globalThis.$1 =');
	script = script.replaceAll(
		'document.currentScript.parentElement',
		'document.body.querySelector(\'div[style*="display: contents"]\')'
	);
	script = script.replace(
		/import\(["'][^"']*scripts\/immutable\/bundle[^"']*\.js["']\)/g,
		'import("./immutable/bundle.js")'
	);

	return script;
}

function collectInlineScripts(html) {
	const tagRe = /<script(\b[^>]*)>([\s\S]*?)<\/script>/gi;
	const matches = [];
	let match;

	while ((match = tagRe.exec(html)) !== null) {
		const attrs = match[1] || '';
		if (/\bsrc\s*=/i.test(attrs)) continue;
		if (!match[2].trim()) continue;

		matches.push({
			full: match[0],
			body: match[2],
			index: match.index
		});
	}

	return matches;
}

function scriptFileName(relativeHtml, scriptIndex, scriptCount) {
	const posixHtml = toPosix(relativeHtml);
	const isRootIndex = posixHtml === 'index.html';
	const stem = path.basename(posixHtml, '.html');

	if (isRootIndex) {
		return scriptIndex === 0 ? 'init.js' : `init-${scriptIndex}.js`;
	}

	const suffix = scriptCount > 1 ? `-${scriptIndex + 1}` : '';
	return `start-${stem}${suffix}.js`;
}

function scriptSrc(extensionDir, htmlFile, scriptName) {
	const htmlDir = path.dirname(path.resolve(htmlFile));
	const target = path.resolve(extensionDir, 'scripts', scriptName);
	let relativeSrc = toPosix(path.relative(htmlDir, target));

	if (!relativeSrc.startsWith('.')) {
		relativeSrc = `./${relativeSrc}`;
	}

	if (htmlDir === path.resolve(extensionDir)) {
		return `./${relativeSrc}`;
	}

	return relativeSrc;
}

export async function runPostBuildScript(outputDir) {
	const extensionDir = outputDir;
	const immutableDir = path.join(extensionDir, 'scripts', 'immutable');
	const assetsDir = path.join(immutableDir, 'assets');
	const scriptsDir = path.join(extensionDir, 'scripts');

	function findAndRenameFiles() {
		const renames = [];

		if (fs.existsSync(immutableDir)) {
			const files = fs.readdirSync(immutableDir);
			const jsFile = files.find((f) => f.startsWith('bundle') && f.endsWith('.js'));

			if (jsFile && jsFile !== 'bundle.js') {
				fs.renameSync(path.join(immutableDir, jsFile), path.join(immutableDir, 'bundle.js'));
				renames.push({ old: `scripts/immutable/${jsFile}`, new: 'scripts/immutable/bundle.js' });
			}
		}

		if (fs.existsSync(assetsDir)) {
			const files = fs.readdirSync(assetsDir);
			const cssFile = files.find((f) => f.startsWith('bundle') && f.endsWith('.css'));

			if (cssFile && cssFile !== 'style.css') {
				fs.renameSync(path.join(assetsDir, cssFile), path.join(assetsDir, 'style.css'));
				renames.push({
					old: `scripts/immutable/assets/${cssFile}`,
					new: 'scripts/immutable/assets/style.css'
				});
			}
		}

		return renames;
	}

	function updateGeneratedHtml(renames) {
		const htmlFiles = findHtmlFiles(extensionDir);
		if (htmlFiles.length === 0) return;

		fs.mkdirSync(scriptsDir, { recursive: true });

		for (const htmlFile of htmlFiles) {
			let html = applyRenames(fs.readFileSync(htmlFile, 'utf-8'), renames);
			const inlineScripts = collectInlineScripts(html);
			const relativeHtml = path.relative(extensionDir, htmlFile);

			if (inlineScripts.length > 0) {
				let nextHtml = html;

				for (let i = inlineScripts.length - 1; i >= 0; i--) {
					const inlineScript = inlineScripts[i];
					const name = scriptFileName(relativeHtml, i, inlineScripts.length);
					const transformed = transformInlineScript(inlineScript.body);
					const src = scriptSrc(extensionDir, htmlFile, name);

					fs.writeFileSync(path.join(scriptsDir, name), transformed, 'utf-8');

					const start = inlineScript.index;
					const end = start + inlineScript.full.length;
					nextHtml =
						nextHtml.slice(0, start) +
						`<script src="${src}" type="module"></script>` +
						nextHtml.slice(end);
				}

				html = nextHtml;
			}

			fs.writeFileSync(htmlFile, html, 'utf-8');
		}
	}

	const renames = findAndRenameFiles();
	updateGeneratedHtml(renames);
}

export default function adapterStaticExtension(options = {}) {
	const { firefox = false, firefoxBuildScript = 'build-firefox', ...staticOptions } = options;
	const adapter = adapterStatic(staticOptions);
	const originalAdapt = adapter.adapt;

	adapter.name = '@cattn/adapter-extension';

	adapter.adapt = async (builder) => {
		await originalAdapt(builder);

		const outputDir = path.resolve(staticOptions.pages || 'build');

		await runPostBuildScript(outputDir);

		if (
			firefox &&
			(process.env.npm_lifecycle_event === firefoxBuildScript ||
				process.env.ADAPTER_EXTENSION_FIREFOX === '1')
		) {
			await applyFirefoxSupport(outputDir, firefox === true ? {} : firefox);
		}
	};

	return adapter;
}
