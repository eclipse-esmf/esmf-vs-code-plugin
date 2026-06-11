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
import { AspectValidationController, RequestClient } from './aspectValidation';
import { TurtleLanguageServer } from './languageServer';
import { SammCliDownloader } from './sammCliDownloader';
import { TurtleExtensionSettings } from './settings';
import { TurtleLanguageClient } from './languageClient';
import type { ExtensionLogger } from './outputChannel';

const SELECT_EXECUTABLE_COMMAND = 'turtle.selectSammCliExecutable';
const SELECT_EXECUTABLE_TITLE = 'Select SAMM-CLI Executable';
const RESTART_LANGUAGE_SERVICES_COMMAND = 'turtle.restartLanguageServices';

let settings: TurtleExtensionSettings;
let languageServer: TurtleLanguageServer | undefined;
let languageClient: TurtleLanguageClient;
let aspectValidationController: AspectValidationController;
let sammCliDownloader: SammCliDownloader;

let outputChannel: ExtensionLogger;
let context: vscode.ExtensionContext;
let restartChain: Promise<void> = Promise.resolve();

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
    context = ctx;
    const logOutputChannel = vscode.window.createOutputChannel('RDF/Turtle and SAMM Aspect Models Language Server', { log: true });
    context.subscriptions.push(logOutputChannel);
    outputChannel = logOutputChannel;
    settings = new TurtleExtensionSettings(context);
    sammCliDownloader = new SammCliDownloader(context, settings, outputChannel);
    languageClient = new TurtleLanguageClient(outputChannel, settings.getSammCliLspServerPort(), settings.getLanguageClientTraceLevel());
    aspectValidationController = new AspectValidationController(createUnavailableClient(), vscode.window, vscode.workspace, outputChannel);
    aspectValidationController.register(context);

    context.subscriptions.push(
        vscode.commands.registerCommand(SELECT_EXECUTABLE_COMMAND, async () => {
            await selectSammCliExecutable();
        }),
        vscode.commands.registerCommand(RESTART_LANGUAGE_SERVICES_COMMAND, async () => {
            await queueLanguageServicesRestart('Manual restart command');
        }),
        vscode.workspace.onDidChangeConfiguration((e: vscode.ConfigurationChangeEvent) => {
            if (e.affectsConfiguration('turtle.languageServerSettings')) {
                void queueLanguageServicesRestart('Configuration change detected');
            }
        })
    );

    if (settings.isEmbeddedLanguageServerStartEnabled() && !settings.getSammCliPath()) {
        const selection = await vscode.window.showErrorMessage(
            'No SAMM CLI path configured. Required for Language Server functionality.',
            'Select or download SAMM CLI Executable',
        );
        if (selection) {
            await selectSammCliExecutable();
        }
        return;
    }

    void queueLanguageServicesRestart('extension activation');

    if (settings.sammCliAutoUpdateIsEnabled() && settings.isEmbeddedLanguageServerStartEnabled()) {
        sammCliDownloader.checkForSammCliUpdates().catch(error => {
            outputChannel.error(`Failed to check for SAMM-CLI updates: ${error instanceof Error ? error.message : String(error)}`);
        });
    }
}

function queueLanguageServicesRestart(reason: string): Promise<void> {
    restartChain = restartChain
        .then(() => restartLanguageServices(reason))
        .catch(error => {
            vscode.window.showErrorMessage(`Failed to start required language services: ${error instanceof Error ? error.message : String(error)}`);
        });

    return restartChain;
}

async function startLanguageServer(): Promise<void> {
    const executablePath = settings.getSammCliPath();
    languageServer = new TurtleLanguageServer(context, outputChannel, executablePath, settings.getSammCliLspServerPort());
    await languageServer.start();
}

async function stopLanguageServer(): Promise<void> {
    if (!languageServer) {
        return;
    }

    await languageServer.stop();
    languageServer = undefined;
}

async function restartLanguageServices(reason: string): Promise<void> {
    outputChannel.info(`Restarting language services (${reason}).`);

    aspectValidationController.setClient(createUnavailableClient());
    await languageClient.disconnect();
    await stopLanguageServer();

    try {
        if (!settings.isEmbeddedLanguageServerStartEnabled()) {
            outputChannel.info('SAMM CLI LSP activation is disabled. Assuming an external server is already running.');
        } else {
            await startLanguageServer();
        }
    } catch (error) {
        await stopLanguageServer().catch(() => undefined);
        aspectValidationController.setClient(createUnavailableClient());

        throw error;
    }

    const nextClient = new TurtleLanguageClient(outputChannel, settings.getSammCliLspServerPort(), settings.getLanguageClientTraceLevel());
    await nextClient.connect();
    languageClient = nextClient;
    aspectValidationController.setClient(nextClient);
}

type SammCliQuickPickItem = vscode.QuickPickItem & {
    action: 'customPath' | 'release';
    releaseTag?: string;
};

async function selectSammCliExecutable(): Promise<void> {
    const releases = await sammCliDownloader.getRecentSammCliReleaseTags(10).catch(error => {
        outputChannel.error(`Failed to fetch SAMM-CLI releases for quick pick: ${error instanceof Error ? error.message : String(error)}`);
        return [];
    });

    const currentPath = settings.getSammCliPath();
    const currentVersion = currentPath ? await sammCliDownloader.runVersionCommand(currentPath).catch(() => undefined) : undefined;

    const customPathItem: SammCliQuickPickItem = {
        label: '$(folder-opened) Use custom SAMM CLI executable or jar',
        detail: currentPath ? `Currently configured: ${currentPath}` : 'Choose an executable from your file system',
        action: 'customPath',
    };

    const separator: SammCliQuickPickItem = {
        label: 'GitHub Releases',
        kind: vscode.QuickPickItemKind.Separator,
        action: 'release',
    };

    const releaseItems: SammCliQuickPickItem[] = releases.map(releaseTag => ({
        label: releaseTag,
        detail: `Download and use this GitHub release${currentVersion === releaseTag ? ' (currently configured)' : ''}`,
        action: 'release',
        releaseTag,
    }));

    if (releaseItems.length === 0) {
        releaseItems.push({
            label: '$(error) No GitHub releases available',
            detail: 'Failed to fetch releases from GitHub. Check output channel for details.',
            action: 'release',
        });
    }

    const pick = await vscode.window.showQuickPick([customPathItem, separator, ...releaseItems], {
        title: 'Select SAMM-CLI executable',
        placeHolder: 'Choose a GitHub release or select a custom executable path',
        matchOnDetail: true,
    });

    if (!pick) {
        return;
    }

    let restartReason: string;

    if (pick.action === 'customPath') {
        const selectedPath = await promptForCustomExecutablePath();
        if (!selectedPath) {
            return;
        }
        await settings.setSammCliPath(selectedPath);
        restartReason = `Changed SAMM CLI to custom executable: ${selectedPath}`;
    } else {
        if (!pick.releaseTag) {
            return;
        }
        const downloadType = await promptForDownloadType();
        if (!downloadType) {
            return;
        }
        const downloadedPath = await sammCliDownloader.downloadRelease(pick.releaseTag, downloadType);
        await settings.setSammCliPath(downloadedPath);
        restartReason = `Changed SAMM CLI to GitHub release ${pick.releaseTag} (${downloadType === 'jar' ? 'JAR' : 'native executable'})`;
    }

    vscode.window.showInformationMessage(restartReason);
    await queueLanguageServicesRestart(restartReason);
}

async function promptForDownloadType(): Promise<'native' | 'jar' | undefined> {
    const items: Array<vscode.QuickPickItem & { value: 'native' | 'jar' }> = [
        {
            label: '$(file-binary) Native Executable',
            detail: 'Platform-specific binary. No Java required.',
            value: 'native',
        },
        {
            label: '$(file-code) JAR (Java Archive)',
            detail: 'Platform-independent. Requires a Java runtime on your system.',
            value: 'jar',
        },
    ];

    const pick = await vscode.window.showQuickPick(items, {
        title: 'Select download type',
        placeHolder: 'Choose between native executable or JAR',
    });

    return pick?.value;
}

async function promptForCustomExecutablePath(): Promise<string | undefined> {
    const selection = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        openLabel: 'Use this executable / jar',
        title: 'Select SAMM-CLI executable / jar',
    });

    return selection?.[0]?.fsPath;
}

function createUnavailableClient(): RequestClient {
    return {
        sendRequest: async () => {
            throw new Error(`The Turtle language server is not available yet. Run '${SELECT_EXECUTABLE_TITLE}' and then reconnect.`);
        },
    };
}

export async function deactivate(): Promise<void> {
    await restartChain;
    await languageClient.disconnect();
    await stopLanguageServer();
}
