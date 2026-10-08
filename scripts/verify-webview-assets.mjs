/*
 * Copyright (c) 2026 Robert Bosch Manufacturing Solutions GmbH
 * SPDX-License-Identifier: MPL-2.0
 */

import {readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {outputDirectory, sha256, webviewAssets} from './webview-assets.mjs';

const actual = readdirSync(outputDirectory).sort();
const expected = webviewAssets.map(asset => asset.destination).sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected out/webview inventory: ${actual.join(', ')}`);
}

for (const asset of webviewAssets) {
    const output = join(outputDirectory, asset.destination);
    if (!statSync(output).isFile() || statSync(output).size === 0) {
        throw new Error(`Missing or empty webview asset: ${asset.destination}`);
    }
    if (sha256(asset.source) !== sha256(output)) {
        throw new Error(`Copied webview asset differs from its source: ${asset.destination}`);
    }
    if (asset.expectedSha256 && sha256(output) !== asset.expectedSha256) {
        throw new Error(`Pinned webview asset hash mismatch: ${asset.destination}`);
    }
}

process.stdout.write(`Verified ${webviewAssets.length} deterministic webview assets.\n`);
