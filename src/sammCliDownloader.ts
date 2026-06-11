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

import * as vscode from 'vscode';
import { constants, createWriteStream } from 'node:fs';
import { access, mkdir, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import extractZip = require('extract-zip');
import * as tar from 'tar';
import { TurtleExtensionSettings } from './settings';
import type { ExtensionLogger } from './outputChannel';
import { GITHUB_RELEASE_REPOSITORY, JAVA_OPTIONS } from './constants';

interface GitHubReleaseAsset {
    name: string;
    browser_download_url: string;
}

interface GitHubRelease {
    tag_name: string;
    assets: Array<GitHubReleaseAsset>;
    draft?: boolean;
    prerelease?: boolean;
}

const SAMM_CLI_STORAGE_DIR = 'SAMM CLI';
const RELEASES_PAGE_SIZE = 20;

export class SammCliDownloader {
    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly settings: TurtleExtensionSettings,
        private readonly outputChannel: ExtensionLogger,
    ) { }

    async checkForSammCliUpdates(): Promise<void> {
        const currentPath = this.settings.getSammCliPath();
        if (!currentPath) {
            this.outputChannel.info('SAMM CLI update check skipped: No SAMM CLI path configured.');
            return;
        }
        const type = currentPath.endsWith('.jar') ? 'jar' : 'native';
        const currentVersion = await this.runVersionCommand(currentPath).catch(error => {
            throw new Error(`Failed to get current SAMM CLI version: ${error instanceof Error ? error.message : String(error)}`);
        });
        const latestVersion = await this.getLatestAvailableSammCliReleaseTag().catch(error => {
            throw new Error(`Failed to check for latest SAMM CLI release: ${error instanceof Error ? error.message : String(error)}`);
        });

        if (this.compareVersions(latestVersion, currentVersion) > 0) {
            const label = currentVersion
                ? `There is a new SAMM CLI release available: ${currentVersion} -> ${latestVersion}`
                : `SAMM CLI ${latestVersion} is available`;
            vscode.window.showInformationMessage(label, 'Download and use').then(async (selection) => {
                if (selection === 'Download and use') {
                    try {
                        const newPath = await this.downloadRelease(latestVersion, type);
                        await this.settings.setSammCliPath(newPath);
                        vscode.window.showInformationMessage(`SAMM CLI ${latestVersion} has been downloaded and configured for use.`);
                    } catch (error) {
                        const message = error instanceof Error ? error.message : 'An unknown error occurred while downloading the latest SAMM CLI release.';
                        vscode.window.showErrorMessage(message);
                    }
                }
            });
        }
    }

    private async getLatestAvailableSammCliReleaseTag(): Promise<string> {
        const releases = await this.getRecentSammCliReleaseTags(1);

        if (releases.length === 0) {
            throw new Error('No SAMM CLI releases are available on GitHub.');
        }

        return releases[0];
    }

    async getRecentSammCliReleaseTags(limit: number): Promise<Array<string>> {
        const response = await fetch(`https://api.github.com/repos/${GITHUB_RELEASE_REPOSITORY}/releases?per_page=${RELEASES_PAGE_SIZE}`, {
            headers: {
                'User-Agent': 'esmf-vs-code-plugin',
                Accept: 'application/vnd.github+json',
            },
        });

        if (!response.ok) {
            return Promise.reject(new Error(this.describeGitHubError('Failed to fetch SAMM CLI releases from GitHub', response)));
        }

        const releases = await response.json() as Array<GitHubRelease>;
        return releases
            .filter(release => !release.draft && !release.prerelease)
            .map(release => release.tag_name)
            .slice(0, limit);
    }

    async downloadRelease(releaseTag: string, type: 'native' | 'jar' = 'native'): Promise<string> {
        const platform = process.platform;
        const release = await this.fetchRelease(releaseTag);
        const asset = type === 'jar'
            // cut 'v' prefix from tag name if present to match asset naming convention (e.g. v1.2.3 -> 1.2.3)
            ? release.assets.find(a => a.name.endsWith(`${releaseTag.replace(/^v/, '')}.jar`))
            : this.selectReleaseAsset(release.assets, platform);

        if (!asset) {
            throw new Error(`No matching release asset was found in ${GITHUB_RELEASE_REPOSITORY}.`);
        }

        const executableName = type === 'jar' ? 'samm.jar' : (platform === 'win32' ? 'samm.exe' : 'samm');
        const targetDirectory = vscode.Uri.joinPath(this.context.globalStorageUri, SAMM_CLI_STORAGE_DIR, release.tag_name);
        const targetPath = vscode.Uri.joinPath(targetDirectory, executableName);

        if (await this.fileExists(targetPath.fsPath)) {
            if (type === 'native') {
                await this.ensureExecutableIsReady(targetPath.fsPath, platform, release.tag_name);
            }
            return targetPath.fsPath;
        }

        await mkdir(targetDirectory.fsPath, { recursive: true });
        this.outputChannel.info(`Downloading ${asset.name} (${release.tag_name})...`);

        if (type === 'jar') {
            await this.downloadJarAsset(asset.browser_download_url, targetPath.fsPath);
        } else {
            await this.downloadAndExtractAsset(asset.browser_download_url, targetDirectory.fsPath, platform);
            await this.ensureExecutableIsReady(targetPath.fsPath, platform, release.tag_name);
        }

        return targetPath.fsPath;
    }

    public async runVersionCommand(executablePath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const [executable, args] = executablePath.endsWith('.jar')
                ? ['java', [...JAVA_OPTIONS, '-jar', executablePath, '--version']]
                : [executablePath, ['--version']];

            const child = spawn(executable, args, { env: process.env });
            let output = '';
            child.stdout.on('data', (data: Buffer) => { output += data.toString(); });
            child.stderr.on('data', (data: Buffer) => { output += data.toString(); });
            child.once('close', (code: number | null) => {
                const match = output.match(/Version:\s*(\d+\.\d+\.\d+)/i);
                if (match) {
                    resolve("v" + match[1]);
                } else {
                    reject(new Error(`Unexpected version command output: ${output}`));
                }
            });
            child.once('error', reject);
        });
    }

    private async fetchRelease(releaseVersion: string): Promise<GitHubRelease> {
        const releasePath = releaseVersion && releaseVersion !== 'latest'
            ? `releases/tags/${encodeURIComponent(releaseVersion)}`
            : 'releases/latest';

        const response = await fetch(`https://api.github.com/repos/${GITHUB_RELEASE_REPOSITORY}/${releasePath}`, {
            headers: {
                'User-Agent': 'esmf-vs-code-plugin',
                Accept: 'application/vnd.github+json',
            },
        });

        if (!response.ok) {
            const target = releaseVersion && releaseVersion !== 'latest' ? `release ${releaseVersion}` : 'the latest release';
            throw new Error(this.describeGitHubError(`Failed to fetch SAMM CLI ${target}`, response));
        }

        return response.json() as Promise<GitHubRelease>;
    }

    private async downloadAndExtractAsset(downloadUrl: string, targetDirectory: string, platform: string): Promise<void> {
        const archivePath = `${targetDirectory}.download`;

        await rm(archivePath, { force: true });

        const response = await fetch(downloadUrl, {
            headers: {
                'User-Agent': 'esmf-vs-code-plugin',
                Accept: 'application/octet-stream',
            },
        });

        if (!response.ok || !response.body) {
            throw new Error(`Failed to download the language server from ${downloadUrl}: ${response.status} ${response.statusText}`);
        }

        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Downloading Language Server (SAMM CLI)...' }, async () => {
            try {
                await pipeline(
                    Readable.fromWeb(response.body as unknown as globalThis.ReadableStream<Uint8Array>),
                    createWriteStream(archivePath),
                );
                await this.extractArchive(archivePath, targetDirectory, platform);
            } finally {
                await rm(archivePath, { force: true });
            }
        });
    }

    private async extractArchive(archivePath: string, extractionPath: string, platform: string): Promise<void> {
        if (platform === 'win32') {
            await extractZip(archivePath, { dir: extractionPath });
            return;
        }

        await tar.x({ file: archivePath, cwd: extractionPath });
    }

    private async downloadJarAsset(downloadUrl: string, targetPath: string): Promise<void> {
        const response = await fetch(downloadUrl, {
            headers: {
                'User-Agent': 'esmf-vs-code-plugin',
                Accept: 'application/octet-stream',
            },
        });

        if (!response.ok || !response.body) {
            throw new Error(`Failed to download the SAMM CLI JAR from ${downloadUrl}: ${response.status} ${response.statusText}`);
        }

        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Downloading SAMM CLI JAR...' }, async () => {
            await pipeline(
                Readable.fromWeb(response.body as unknown as globalThis.ReadableStream<Uint8Array>),
                createWriteStream(targetPath),
            );
        });
    }

    private selectReleaseAsset(assets: Array<GitHubReleaseAsset>, platform: string): GitHubReleaseAsset {
        let assetOsIdentifier: string;
        switch (platform) {
            case 'win32':
                assetOsIdentifier = "windows";
                break;
            case 'darwin':
                assetOsIdentifier = "macos";
                break;
            case 'linux':
                assetOsIdentifier = "linux";
                break;
            default:
                throw new Error(`Unsupported platform: ${process.platform}`);
        }

        const foundAsset = assets.find(asset => asset.name.includes(assetOsIdentifier));

        if (!foundAsset) {
            throw new Error(`No matching release asset found for ${assetOsIdentifier} in the available assets: ${assets.map(a => a.name).join(', ')}`);
        }

        return foundAsset;
    }

    private async ensureExecutableIsReady(executablePath: string, platform: string, releaseTag: string): Promise<void> {
        if (!await this.fileExists(executablePath)) {
            throw new Error(`Downloaded SAMM CLI ${releaseTag} did not contain expected executable at ${executablePath}.`);
        }

        if (platform === 'win32') {
            return;
        }

        try {
            await access(executablePath, constants.X_OK);
        } catch {
            throw new Error(`Downloaded SAMM CLI executable is not marked as executable: ${executablePath}`);
        }
    }

    /**
     * Compares two SAMM CLI version tags (e.g. `v2.10.0`, `2.12.0`).
     * Returns a positive number when `a` is newer than `b`, a negative number
     * when it is older, and `0` when they are equal. Pre-release suffixes are
     * ignored. An unparsable/empty version is treated as the oldest.
     */
    private compareVersions(a: string, b: string): number {
        const parse = (version: string): Array<number> => {
            const match = version.match(/(\d+)\.(\d+)\.(\d+)/);
            return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [-1, -1, -1];
        };

        const left = parse(a);
        const right = parse(b);

        for (let i = 0; i < left.length; i++) {
            if (left[i] !== right[i]) {
                return left[i] - right[i];
            }
        }

        return 0;
    }

    private describeGitHubError(prefix: string, response: Response): string {
        const isRateLimited = response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0';
        if (isRateLimited) {
            const reset = response.headers.get('x-ratelimit-reset');
            const resetHint = reset ? ` Try again after ${new Date(Number(reset) * 1000).toLocaleTimeString()}.` : '';
            return `${prefix}: GitHub API rate limit exceeded.${resetHint}`;
        }

        return `${prefix}: ${response.status} ${response.statusText}`;
    }

    private async fileExists(filePath: string): Promise<boolean> {
        try {
            return (await stat(filePath)).isFile();
        } catch {
            return false;
        }
    }
}
