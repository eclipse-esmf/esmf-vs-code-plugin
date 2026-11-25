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

// Resolves a SAMM CLI executable for the tests, in this order:
//   1. SAMM_CLI_PATH environment variable (used as-is)
//   2. latest eclipse-esmf/esmf-sdk release, cached in .samm-cli/<tag>/: the native executable for this OS and CPU
//      (in native/), or the platform-independent JAR (requires Java) when no matching native build is published
//   3. newest cached release when GitHub cannot be reached (offline development)
// Usage: node scripts/fetch-samm-cli.mjs   (prints the resolved executable path)
// Set GITHUB_TOKEN to avoid GitHub API rate limits (e.g. in CI).

import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync} from 'node:fs';
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
// Platform-independent build, e.g. samm-cli-2.16.2.jar (not the -javadoc/-sources/-tests JARs).
const JAR_ASSET_PATTERN = /^samm-cli-\d+\.\d+\.\d+\.jar$/;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

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

    const {asset, kind} = selectAsset(release);
    const target = kind === 'native' ? cachedExecutablePath(release.tag_name) : join(cacheRoot, release.tag_name, asset.name);
    if (existsSync(target)) {
        return {path: target, version: readVersion(target), source: 'cache'};
    }

    if (kind === 'jar') {
        log(`[samm-cli] No native ${release.tag_name} build for ${process.platform}/${process.arch}; using ${asset.name} (requires Java).`);
    }
    log(`[samm-cli] Downloading ${asset.name} (${release.tag_name})...`);
    if (kind === 'jar') {
        mkdirSync(join(cacheRoot, release.tag_name), {recursive: true});
        await downloadFile(asset, target, log);
        return {path: target, version: readVersion(target), source: 'download'};
    }
    await downloadAndExtract(asset, join(cacheRoot, release.tag_name, 'native'), log);
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

/** @returns {{asset: {name: string, browser_download_url: string, digest?: string | null}, kind: 'native' | 'jar'}} */
function selectAsset(release) {
    const os = {win32: 'windows', darwin: 'macos', linux: 'linux'}[process.platform];
    const architectures = {x64: ['x86_64', 'amd64'], arm64: ['aarch64', 'arm64']}[process.arch] ?? [];
    const native =
        os && release.assets.find(candidate => architectures.some(architecture => candidate.name.includes(`-${os}-${architecture}.`)));
    if (native) {
        return {asset: native, kind: 'native'};
    }
    const jar = release.assets.find(candidate => JAR_ASSET_PATTERN.test(candidate.name));
    if (jar) {
        return {asset: jar, kind: 'jar'};
    }
    throw new Error(
        `No SAMM CLI ${release.tag_name} asset for ${process.platform}/${process.arch}. ` +
            `Available: ${release.assets.map(candidate => candidate.name).join(', ')}. Set SAMM_CLI_PATH instead.`,
    );
}

// Verifies the SHA-256 digest GitHub publishes for the asset before the file is moved into place.
async function downloadFile(asset, destination, log) {
    const url = asset.browser_download_url;
    const partial = `${destination}.${process.pid}.download`;
    const expected = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest ?? '')?.[1]?.toLowerCase();
    if (!expected) {
        log(`[samm-cli] No SHA-256 digest published for ${asset.name}; skipping the integrity check.`);
    }
    try {
        // Covers the whole transfer, including the body, so a stalled connection cannot hang the run.
        const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
        const response = await fetch(url, {headers: {'User-Agent': 'esmf-vs-code-plugin-tests'}, signal});
        if (!response.ok || !response.body) {
            throw new Error(`Download failed: ${response.status} ${response.statusText} (${url})`);
        }
        const hash = createHash('sha256');
        await pipeline(
            Readable.fromWeb(response.body),
            async function* (chunks) {
                for await (const chunk of chunks) {
                    hash.update(chunk);
                    yield chunk;
                }
            },
            createWriteStream(partial),
        );
        const actual = hash.digest('hex');
        if (expected && actual !== expected) {
            throw new Error(`SHA-256 mismatch for ${asset.name}: expected ${expected}, got ${actual}.`);
        }
        try {
            renameSync(partial, destination);
        } catch (error) {
            // Another run may have published (and be using) the same file already.
            if (!existsSync(destination)) {
                throw error;
            }
        }
    } catch (error) {
        if (error?.name === 'TimeoutError') {
            throw new Error(`Download timed out after ${DOWNLOAD_TIMEOUT_MS / 1000} s (${url}).`);
        }
        throw error;
    } finally {
        rmSync(partial, {force: true});
    }
}

// Extracts into a private staging directory and renames it into place, so targetDirectory is either absent or
// complete, even if this process is killed or another test run downloads the same release concurrently.
async function downloadAndExtract(asset, targetDirectory, log) {
    const staging = `${targetDirectory}.${process.pid}.tmp`;
    const archive = `${staging}.archive`;
    rmSync(staging, {recursive: true, force: true});
    mkdirSync(staging, {recursive: true});
    try {
        await downloadFile(asset, archive, log);
        if (asset.name.endsWith('.zip')) {
            await extractZip(archive, {dir: staging});
        } else {
            await tar.x({file: archive, cwd: staging});
        }
        const executable = join(staging, executableName);
        if (!existsSync(executable)) {
            throw new Error(`${asset.name} did not contain the expected executable ${executableName}.`);
        }
        if (process.platform !== 'win32') {
            chmodSync(executable, 0o755);
        }
        publishDirectory(staging, targetDirectory);
    } finally {
        rmSync(staging, {recursive: true, force: true});
        rmSync(archive, {force: true});
    }
}

function publishDirectory(staging, targetDirectory) {
    const complete = () => existsSync(join(targetDirectory, executableName));
    for (let attempt = 0; ; attempt++) {
        try {
            renameSync(staging, targetDirectory);
            return;
        } catch (error) {
            if (complete()) {
                return; // another run published a complete copy first
            }
            if (attempt > 0 || !existsSync(targetDirectory)) {
                throw error;
            }
            // Leftover without an executable (e.g. from an older version of this script).
            rmSync(targetDirectory, {recursive: true, force: true});
        }
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
        .map(tag => ({tag, path: cachedPathForTag(tag)}))
        .filter(entry => entry.path)
        .sort((left, right) => {
            const [a, b] = [parse(left.tag), parse(right.tag)];
            return b[0] - a[0] || b[1] - a[1] || b[2] - a[2];
        })[0];
    return newest;
}

// Prefers the cached native executable of a release over its cached JAR.
function cachedPathForTag(tag) {
    const native = cachedExecutablePath(tag);
    if (existsSync(native)) {
        return native;
    }
    const directory = join(cacheRoot, tag);
    const jar = existsSync(directory) ? readdirSync(directory).find(name => JAR_ASSET_PATTERN.test(name)) : undefined;
    return jar ? join(directory, jar) : undefined;
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
