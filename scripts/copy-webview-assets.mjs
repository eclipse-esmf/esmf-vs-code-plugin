/*
 * Copyright (c) 2026 Robert Bosch Manufacturing Solutions GmbH
 * SPDX-License-Identifier: MPL-2.0
 */

import {copyFileSync, mkdirSync, readdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {outputDirectory, sha256, webviewAssets} from './webview-assets.mjs';

for (const asset of webviewAssets) {
    if (asset.expectedSha256 && sha256(asset.source) !== asset.expectedSha256) {
        throw new Error(`Pinned webview asset hash mismatch: ${asset.destination}`);
    }
}

rmSync(outputDirectory, {recursive: true, force: true});
mkdirSync(outputDirectory, {recursive: true});
for (const asset of webviewAssets) {
    copyFileSync(asset.source, join(outputDirectory, asset.destination));
}

const actual = readdirSync(outputDirectory).sort();
const expected = webviewAssets.map(asset => asset.destination).sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('Webview asset copy produced an unexpected inventory.');
}
