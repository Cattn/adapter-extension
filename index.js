import fs from 'fs';
import path from 'path';
import adapterStatic from '@sveltejs/adapter-static';

async function runPostBuildScript(outputDir) {
	const extensionDir = outputDir;
	const immutableDir = path.join(extensionDir, 'scripts', 'immutable');
	const assetsDir = path.join(immutableDir, 'assets');
	const indexPath = path.join(extensionDir, 'index.html');

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

	function updateIndexHtml(renames) {
		if (!fs.existsSync(indexPath)) return;

		let html = fs.readFileSync(indexPath, 'utf-8');

		for (const { old, new: newPath } of renames) {
			const patterns = [new RegExp(old, 'g'), new RegExp('\\./' + old, 'g')];

			for (const pattern of patterns) {
				html = html.replace(pattern, './' + newPath);
			}
		}

		const inlineScriptMatch = html.match(
			/<script>\s*\{\s*(__sveltekit_\w+)\s*=[\s\S]*?import\("\.\/\.\/scripts\/immutable\/bundle\.js"\)[\s\S]*?\}\s*<\/script>/
		);

		if (inlineScriptMatch) {
			const svelteKitVar = inlineScriptMatch[1];

			const initJsContent = `globalThis.${svelteKitVar} = {
                    base: new URL(".", location).pathname.slice(0, -1)
                };

                const element = document.body.querySelector('div[style*="display: contents"]');

                import("./immutable/bundle.js").then((app) => {
                    app.start(element, {
                        node_ids: [0, 2],
                        data: [null,null],
                        form: null,
                        error: null
                    })
                });
            `;

			fs.writeFileSync(path.join(extensionDir, 'scripts', 'init.js'), initJsContent, 'utf-8');
			html = html.replace(
				inlineScriptMatch[0],
				'<script src="././scripts/init.js" type="module"></script>'
			);
		}

		fs.writeFileSync(indexPath, html, 'utf-8');
	}

	const renames = findAndRenameFiles();
	updateIndexHtml(renames);
}

export default function adapterStaticExtension(options = {}) {
	const adapter = adapterStatic(options);
	const originalAdapt = adapter.adapt;

	adapter.adapt = async (builder) => {
		await originalAdapt(builder);

		const outputDir = path.resolve(options.pages || 'build');

		await runPostBuildScript(outputDir);
	};

	return adapter;
}
