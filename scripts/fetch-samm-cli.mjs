/*
 * Copyright (c) 2026 Robert Bosch Manufacturing Solutions GmbH
 *
 * See the AUTHORS file(s) distributed with this work for additional
 * information regarding authorship.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * SPDX-License-Identifier: MPL-2.0
 */

// Resolves a native SAMM CLI executable for the tests, in this order:
//   1. SAMM_CLI_PATH environment variable (used as-is)
//   2. latest eclipse-esmf/esmf-sdk release, cached in .samm-cli/<tag>/native/
//   3. newest cached release when GitHub cannot be reached (offline development)
// Usage: node scripts/fetch-samm-cli.mjs   (prints the resolved executable path)
// Set GITHUB_TOKEN to avoid GitHub API rate limits (e.g. in CI).

import {spawnSync} from 'node:child_process';
import {chmodSync, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {pathToFileURL} from 'node:url';
import extractZip from 'extract-zip';
import * as tar from 'tar';
import {extensionRoot} from './webview-assets.mjs';

const RELEASE_REPOSITORY = 'eclipse-esmf/esmf-sdk';
const cacheRoot = resolve(extensionRoot, '.samm-cli');
const executableName = process.platform === 'win32' ? 'samm.exe' : 'samm';

/** @returns {Promise<{path: string, version: string, source: 'env' | 'download' | 'cache' | 'offline-cache'}>} */
export async function resolveSammCli(log = message => console.error(message)) {
    const configuredPath = process.env.SAMM_CLI_PATH;
    if (configuredPath) {
        if (!existsSync(configuredPath)) {
            throw new Error(`SAMM_CLI_PATH points to a missing file: ${configuredPath}`);
        }
        return {path: resolve(configuredPath), version: readVersion(configuredPath), source: 'env'};
    }

    let release;
    try {
        release = await fetchLatestRelease();
    } catch (error) {
        const cached = newestCachedExecutable();
        if (!cached) {
            throw new Error(`Cannot determine the latest SAMM CLI release and no cached copy exists: ${error.message}`);
        }
        log(`[samm-cli] GitHub not reachable (${error.message}); using cached ${cached.tag}.`);
        return {path: cached.path, version: readVersion(cached.path), source: 'offline-cache'};
    }

    const target = cachedExecutablePath(release.tag_name);
    if (existsSync(target)) {
        return {path: target, version: readVersion(target), source: 'cache'};
    }

    const asset = selectAsset(release);
    log(`[samm-cli] Downloading ${asset.name} (${release.tag_name})...`);
    await downloadAndExtract(asset.browser_download_url, join(cacheRoot, release.tag_name, 'native'));
    if (!existsSync(target)) {
        throw new Error(`${asset.name} did not contain the expected executable ${executableName}.`);
    }
    if (process.platform !== 'win32') {
        chmodSync(target, 0o755);
    }
    return {path: target, version: readVersion(target), source: 'download'};
}

async function fetchLatestRelease() {
    const headers = {'User-Agent': 'esmf-vs-code-plugin-tests', Accept: 'application/vnd.github+json'};
    if (process.env.GITHUB_TOKEN) {
        headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    const response = await fetch(`https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`, {
        headers,
        signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
        throw new Error(`GitHub API responded ${response.status} ${response.statusText}`);
    }
    return response.json();
}

function selectAsset(release) {
    const os = {win32: 'windows', darwin: 'macos', linux: 'linux'}[process.platform];
    const asset = os && release.assets.find(candidate => candidate.name.includes(`-${os}-`));
    if (!asset) {
        throw new Error(
            `No SAMM CLI ${release.tag_name} asset for ${process.platform}/${process.arch}. ` +
                `Available: ${release.assets.map(candidate => candidate.name).join(', ')}. Set SAMM_CLI_PATH instead.`,
        );
    }
    return asset;
}

async function downloadAndExtract(url, targetDirectory) {
    const archive = `${targetDirectory}.download`;
    rmSync(targetDirectory, {recursive: true, force: true});
    mkdirSync(targetDirectory, {recursive: true});
    try {
        const response = await fetch(url, {headers: {'User-Agent': 'esmf-vs-code-plugin-tests'}});
        if (!response.ok || !response.body) {
            throw new Error(`Download failed: ${response.status} ${response.statusText} (${url})`);
        }
        await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
        if (url.endsWith('.zip')) {
            await extractZip(archive, {dir: targetDirectory});
        } else {
            await tar.x({file: archive, cwd: targetDirectory});
        }
    } catch (error) {
        rmSync(targetDirectory, {recursive: true, force: true});
        throw error;
    } finally {
        rmSync(archive, {force: true});
    }
}

function cachedExecutablePath(tag) {
    return join(cacheRoot, tag, 'native', executableName);
}

function newestCachedExecutable() {
    if (!existsSync(cacheRoot)) {
        return undefined;
    }
    const parse = tag => (/(\d+)\.(\d+)\.(\d+)/.exec(tag) ?? []).slice(1).map(Number);
    const newest = readdirSync(cacheRoot)
        .filter(tag => existsSync(cachedExecutablePath(tag)))
        .sort((left, right) => {
            const [a, b] = [parse(left), parse(right)];
            return b[0] - a[0] || b[1] - a[1] || b[2] - a[2];
        })[0];
    return newest ? {tag: newest, path: cachedExecutablePath(newest)} : undefined;
}

function readVersion(executable) {
    const [command, args] = executable.endsWith('.jar') ? ['java', ['-jar', executable, '--version']] : [executable, ['--version']];
    const result = spawnSync(command, args, {encoding: 'utf8', timeout: 60_000});
    const match = /Version:\s*(\d+\.\d+\.\d+)/i.exec(`${result.stdout ?? ''}${result.stderr ?? ''}`);
    return match ? `v${match[1]}` : 'unknown';
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    resolveSammCli()
        .then(cli => {
            console.error(`[samm-cli] ${cli.version} (${cli.source})`);
            console.log(cli.path);
        })
        .catch(error => {
            console.error(`[samm-cli] ${error.message}`);
            process.exit(1);
        });
}
