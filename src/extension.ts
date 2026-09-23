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
import {AspectValidationController, RequestClient} from './aspectValidation';
import {GraphicalViewController} from './graphicalView';
import {LspGraphicalViewClient} from './graphicalViewClient';
import {VscodeGraphicalViewPanelFactory} from './graphicalViewPanel';
import {GitHubRepositoryValidator} from './githubRepositoryValidator';
import {TurtleLanguageClient} from './languageClient';
import {TurtleLanguageServer} from './languageServer';
import {LanguageServicesMode, LanguageServicesSupervisor, TerminalAction} from './languageServicesSupervisor';
import type {ExtensionLogger} from './outputChannel';
import {SammCliDownloader} from './sammCliDownloader';
import {TurtleExtensionSettings} from './settings';

const SELECT_EXECUTABLE_COMMAND = 'semantic-models.selectSammCliExecutable';
const SELECT_EXECUTABLE_TITLE = 'Select SAMM CLI Executable';
const RESTART_LANGUAGE_SERVICES_COMMAND = 'semantic-models.restartLanguageServices';
const GITHUB_REPOSITORY_VALIDATION_DEBOUNCE_MS = 2000;

let settings: TurtleExtensionSettings;
let aspectValidationController: AspectValidationController;
let graphicalViewController: GraphicalViewController;
let sammCliDownloader: SammCliDownloader;
let gitHubRepositoryValidator: GitHubRepositoryValidator;

let outputChannel: ExtensionLogger;
let logOutputChannel: vscode.LogOutputChannel;
let context: vscode.ExtensionContext;
let languageServicesSupervisor: LanguageServicesSupervisor;
let githubRepositoryValidationTimeout: ReturnType<typeof setTimeout> | undefined;

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
    context = ctx;
    logOutputChannel = vscode.window.createOutputChannel('Semantic Models', { log: true });
    context.subscriptions.push(logOutputChannel);
    outputChannel = logOutputChannel;
    settings = new TurtleExtensionSettings();
    sammCliDownloader = new SammCliDownloader(context, settings, outputChannel);
    gitHubRepositoryValidator = new GitHubRepositoryValidator(outputChannel);
    aspectValidationController = new AspectValidationController(createUnavailableClient(), vscode.window, vscode.workspace, outputChannel);
    aspectValidationController.register(context);
    graphicalViewController = new GraphicalViewController(
        undefined,
        new VscodeGraphicalViewPanelFactory(context.extensionUri),
        vscode.commands,
        vscode.window,
        {
            onDidSaveTextDocument: listener => vscode.workspace.onDidSaveTextDocument(listener),
            onDidChangeDocumentAvailability: listener =>
                vscode.Disposable.from(
                    vscode.workspace.onDidOpenTextDocument(document => listener(document.uri.toString(), true)),
                    vscode.workspace.onDidCloseTextDocument(document => listener(document.uri.toString(), false)),
                    vscode.window.tabGroups.onDidChangeTabs(event => {
                        for (const tab of event.closed) {
                            if (tab.input instanceof vscode.TabInputText) {
                                const sourceUri = tab.input.uri.toString();
                                const remainsOpen = vscode.window.tabGroups.all.some(group =>
                                    group.tabs.some(
                                        candidate =>
                                            candidate.input instanceof vscode.TabInputText &&
                                            candidate.input.uri.toString() === sourceUri,
                                    ),
                                );
                                if (!remainsOpen) {
                                    listener(sourceUri, false);
                                }
                            }
                        }
                    }),
                ),
            isDocumentAvailable: uri => vscode.workspace.textDocuments.some(document => document.uri.toString() === uri),
        },
        outputChannel,
    );
    graphicalViewController.register(context);
    languageServicesSupervisor = createLanguageServicesSupervisor();

    context.subscriptions.push(
        vscode.languages.setLanguageConfiguration('turtle', {
            onEnterRules: [
                {
                    beforeText: /\.\s*$/,
                    action: {
                        indentAction: vscode.IndentAction.Outdent,
                        appendText: '\n',
                    },
                },
            ],
        }),
    );

    context.subscriptions.push(
        logOutputChannel.onDidChangeLogLevel(() => {
            void languageServicesSupervisor.restart('Log level changed');
        }),
        vscode.commands.registerCommand(SELECT_EXECUTABLE_COMMAND, async () => {
            await selectSammCliExecutable();
        }),
        vscode.commands.registerCommand(RESTART_LANGUAGE_SERVICES_COMMAND, async () => {
            await languageServicesSupervisor.restart('Manual restart command');
        }),
        vscode.workspace.onDidChangeConfiguration((e: vscode.ConfigurationChangeEvent) => {
            if (e.affectsConfiguration('semantic-models.languageServerSettings')) {
                void languageServicesSupervisor.restart('Configuration change detected');
            }
            if (e.affectsConfiguration('semantic-models.modelResolution')) {
                scheduleGithubRepositoryValidation();
            }
        }),
    );

    void validateConfiguredGithubRepositories();

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

    void languageServicesSupervisor.start('extension activation');

    if (settings.sammCliAutoUpdateIsEnabled() && settings.isEmbeddedLanguageServerStartEnabled()) {
        sammCliDownloader.checkForSammCliUpdates().catch(error => {
            outputChannel.error(`Failed to check for SAMM CLI updates: ${error instanceof Error ? error.message : String(error)}`);
        });
    }
}

async function validateConfiguredGithubRepositories(): Promise<void> {
    await gitHubRepositoryValidator.validate(settings.getGithubRepositories());
}

// Wait for configuration edits to settle (e.g. while the user is still typing in settings.json)
// before validating, instead of validating after every keystroke.
function scheduleGithubRepositoryValidation(): void {
    if (githubRepositoryValidationTimeout) {
        clearTimeout(githubRepositoryValidationTimeout);
    }

    githubRepositoryValidationTimeout = setTimeout(() => {
        githubRepositoryValidationTimeout = undefined;
        void validateConfiguredGithubRepositories();
    }, GITHUB_REPOSITORY_VALIDATION_DEBOUNCE_MS);
}

function createLanguageServicesSupervisor(): LanguageServicesSupervisor {
    return new LanguageServicesSupervisor({
        configuration: () => ({
            mode: settings.isEmbeddedLanguageServerStartEnabled() ? 'embedded' : 'external',
            port: settings.getSammCliLspServerPort(),
        }),
        createServer: configuration => new TurtleLanguageServer(
            context,
            outputChannel,
            settings.getSammCliPath(),
            configuration.port,
            settings.getSammCliLspAdditionalStartupOptions(),
            logOutputChannel.logLevel,
        ),
        createClient: configuration => new TurtleLanguageClient(outputChannel, configuration.port, logOutputChannel.logLevel),
        setRequestClient: (client, generation) => {
            aspectValidationController.setClient(client, generation);
            graphicalViewController.setClient(
                client instanceof TurtleLanguageClient ? new LspGraphicalViewClient(client) : undefined,
            );
        },
        unavailableClient: createUnavailableClient,
        logger: outputChannel,
        notifyTerminal: notifyTerminalRecoveryFailure,
        showOutput: () => logOutputChannel.show(true),
        showSettings: () => {
            void vscode.commands.executeCommand('workbench.action.openSettings', 'semantic-models.languageServerSettings');
        },
    });
}

async function notifyTerminalRecoveryFailure(mode: LanguageServicesMode): Promise<TerminalAction> {
    const guidance =
        mode === 'external'
            ? 'Start or check the separately managed language server, then retry.'
            : 'Check the configured SAMM CLI executable and extension settings.';
    const selection = await vscode.window.showErrorMessage(
        `The Turtle language server could not be recovered after four attempts. ${guidance}`,
        'Restart Now',
        'Show Language Server Output',
        'Check Extension Settings',
    );
    if (selection === 'Restart Now') {
        return 'restart';
    }
    if (selection === 'Show Language Server Output') {
        return 'output';
    }
    if (selection === 'Check Extension Settings') {
        return 'settings';
    }
    return undefined;
}

type SammCliQuickPickItem = vscode.QuickPickItem & {
    action: 'customPath' | 'release';
    releaseTag?: string;
};

async function selectSammCliExecutable(): Promise<void> {
    const releases = await sammCliDownloader.getRecentSammCliReleaseTags(10).catch(error => {
        outputChannel.error(`Failed to fetch SAMM CLI releases for quick pick: ${error instanceof Error ? error.message : String(error)}`);
        return [];
    });

    const currentPath = settings.getSammCliPath();
    const currentVersion = currentPath ? await sammCliDownloader.runVersionCommand(currentPath).catch(() => undefined) : undefined;

    const customPathItem: SammCliQuickPickItem = {
        label: '$(folder-opened) Use custom SAMM CLI executable or jar file',
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
        title: 'Select SAMM CLI executable',
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
        await settings.setEmbeddedLanguageServerStartEnabled(true);
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
        await settings.setEmbeddedLanguageServerStartEnabled(true);
        restartReason = `Changed SAMM CLI to GitHub release ${pick.releaseTag} (${downloadType === 'jar' ? 'JAR' : 'native executable'})`;
    }

    vscode.window.showInformationMessage(restartReason);
    await languageServicesSupervisor.restart(restartReason);
}

async function promptForDownloadType(): Promise<'native' | 'jar' | undefined> {
    const items: Array<vscode.QuickPickItem & {value: 'native' | 'jar'}> = [
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
        defaultUri: vscode.Uri.file(settings.getSammCliPath() || ''),
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        openLabel: 'Use this executable / JAR',
        title: 'Select SAMM CLI executable / JAR',
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
    if (githubRepositoryValidationTimeout) {
        clearTimeout(githubRepositoryValidationTimeout);
        githubRepositoryValidationTimeout = undefined;
    }
    await languageServicesSupervisor?.dispose();
}
