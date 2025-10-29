# adapter-extension
Svelte adapter that makes chrome extension support easier

## Installation

``npm i -D @cattn/adapter-extension``

## Usage

### Svelte Config
Your ``svelte.config.js`` should look something like this. Feel free to change the adapter values, these are just my suggested ones.
```js
import adapter from '@cattn/adapter-extension';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		appDir: 'scripts',
		adapter: adapter({
			// default options are shown. On some platforms
			// these options are set automatically — see below
			pages: 'extension',
			assets: 'extension',
			fallback: undefined,
			precompress: false,
			strict: true
		}),
		output: {
			bundleStrategy: 'single'
		}
	},
};

export default config;
```

Also, make sure you have ``routes/+layout.ts`` created, with the following

```js
export const prerender = true;
```

### Chrome Manifest Options

Make sure in your chrome manifest, you have the following (you can change ``<all_urls>`` to whatever set of URLs your extension will be active on. Also, ``scripts`` may be different depending on your ``appDir`` value.)

```json
"content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["scripts/init.js"]
    }
  ],
```

Also, I'd recommend putting your ``manifest.json``, and any other seperate scripts, in your ``static/`` folder, as that will be copied directly into your build folder, allowing for a seamless build.

## Other info

This adapter uses ``adapter-static`` under the hood, with a few modifications to make building for chrome extensions slightly less painful.

With this, you can use chrome extension APIs directly in your svelte app.