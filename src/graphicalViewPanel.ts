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

import {randomBytes} from 'node:crypto';
import * as vscode from 'vscode';
import {GRAPHICAL_VIEW_MARKER_PATTERN} from './graphicalViewProtocol';

const VIEW_TYPE = 'semantic-models.graphicalView';
export const WEBVIEW_ASSET_DIRECTORY = Object.freeze(['out', 'webview'] as const);
export const WEBVIEW_SCRIPT_ORDER = Object.freeze(['webview.js'] as const);

export type GraphicalViewStatus =
    | Readonly<{kind: 'loading'; message: string}>
    | Readonly<{kind: 'ready'; message: string}>
    | Readonly<{kind: 'stale'; reason: string; message: string}>
    | Readonly<{kind: 'unsupported'; message: string}>
    | Readonly<{kind: 'disconnected'; message: string}>;

export type GraphicalViewDelivery =
    | Readonly<{type: 'status'; status: GraphicalViewStatus}>
    | Readonly<{type: 'render'; version: number; svg: string}>;

export type GraphicalViewPanelMessage =
    | Readonly<{type: 'ready'}>
    | Readonly<{type: 'refresh'}>
    | Readonly<{type: 'rendered'; version: number}>
    | Readonly<{type: 'renderError'; version: number; reason: 'xmlParsingFailed'}>
    | Readonly<{type: 'navigate'; version: number; targetId: string}>;

export interface GraphicalViewPanel extends vscode.Disposable {
    readonly visible: boolean;
    reveal(): void;
    deliver(delivery: GraphicalViewDelivery): void;
    onDidDispose(listener: () => void): vscode.Disposable;
    onDidChangeVisibility(listener: (visible: boolean) => void): vscode.Disposable;
    onDidReceiveMessage(listener: (message: unknown) => void): vscode.Disposable;
}

export interface GraphicalViewPanelFactory {
    create(sourceUri: string): GraphicalViewPanel;
}

export class VscodeGraphicalViewPanelFactory implements GraphicalViewPanelFactory {
    constructor(private readonly extensionUri: vscode.Uri) {}

    create(sourceUri: string): GraphicalViewPanel {
        const uri = vscode.Uri.parse(sourceUri, true);
        const name = uri.path.split('/').filter(Boolean).at(-1) ?? 'Aspect Model';
        const panel = vscode.window.createWebviewPanel(
            VIEW_TYPE,
            `Graphical View: ${name}`,
            vscode.ViewColumn.Beside,
            createGraphicalViewPanelOptions(this.extensionUri),
        );
        return new VscodeGraphicalViewPanel(panel, this.extensionUri);
    }
}

class VscodeGraphicalViewPanel implements GraphicalViewPanel {
    constructor(
        private readonly panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
    ) {
        panel.webview.html = createGraphicalViewShell(panel.webview, extensionUri);
    }

    get visible(): boolean {
        return this.panel.visible;
    }

    reveal(): void {
        this.panel.reveal(undefined, false);
    }

    deliver(delivery: GraphicalViewDelivery): void {
        void this.panel.webview.postMessage(delivery);
    }

    onDidDispose(listener: () => void): vscode.Disposable {
        return this.panel.onDidDispose(listener);
    }

    onDidChangeVisibility(listener: (visible: boolean) => void): vscode.Disposable {
        return this.panel.onDidChangeViewState(event => listener(event.webviewPanel.visible));
    }

    onDidReceiveMessage(listener: (message: unknown) => void): vscode.Disposable {
        return this.panel.webview.onDidReceiveMessage(listener);
    }

    dispose(): void {
        this.panel.dispose();
    }
}

export function webviewAssetDirectory(extensionUri: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(extensionUri, ...WEBVIEW_ASSET_DIRECTORY);
}

export function createGraphicalViewPanelOptions(extensionUri: vscode.Uri): vscode.WebviewPanelOptions & vscode.WebviewOptions {
    return {
        enableScripts: true,
        enableForms: false,
        enableCommandUris: false,
        localResourceRoots: [webviewAssetDirectory(extensionUri)],
    };
}

export function createGraphicalViewShell(
    webview: Pick<vscode.Webview, 'asWebviewUri' | 'cspSource'>,
    extensionUri: vscode.Uri,
): string {
    const nonce = randomBytes(18).toString('base64');
    const assetDirectory = webviewAssetDirectory(extensionUri);
    const stylesheetUri = webview.asWebviewUri(vscode.Uri.joinPath(assetDirectory, 'webview.css'));
    const scriptUris = WEBVIEW_SCRIPT_ORDER.map(asset => webview.asWebviewUri(vscode.Uri.joinPath(assetDirectory, asset)));
    const csp = [
        "default-src 'none'",
        `script-src 'nonce-${nonce}'`,
        `style-src ${webview.cspSource}`,
        `font-src ${webview.cspSource}`,
        "img-src 'none'",
        "connect-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="${stylesheetUri}">
    <title>Graphical View</title>
</head>
<body>
    <div id="toolbar" role="toolbar" aria-label="Graphical view controls">
        <div id="toolbar-controls">
            <button id="refresh" class="primary-action" type="button" aria-label="Refresh graphical view" title="Refresh">Refresh</button>
            <span class="toolbar-separator" aria-hidden="true"></span>
            <div id="zoom-controls" role="group" aria-label="Zoom controls">
                <button id="zoom-out" class="toolbar-action icon-action" type="button" aria-label="Zoom out" title="Zoom out">−</button>
                <output id="zoom-value" aria-live="polite">100%</output>
                <button id="zoom-in" class="toolbar-action icon-action" type="button" aria-label="Zoom in" title="Zoom in">+</button>
                <button id="zoom-reset" class="toolbar-action" type="button" aria-label="Reset zoom to 100 percent" title="Reset zoom">Reset</button>
                <button id="zoom-fit" class="toolbar-action" type="button" aria-label="Fit diagram to view" title="Fit to view">Fit</button>
            </div>
        </div>
        <p id="status" role="status" aria-live="polite" aria-atomic="true" data-kind="loading" title="Preparing graphical view...">
            <span id="status-indicator" aria-hidden="true"></span>
            <span id="status-text">Preparing graphical view...</span>
        </p>
    </div>
    <main id="viewport" tabindex="0" aria-label="Scrollable graphical view">
        <div id="diagram" aria-live="off"></div>
    </main>
    <script nonce="${nonce}" src="${scriptUris[0]}"></script>
</body>
</html>`;
}

export function parseGraphicalViewPanelMessage(value: unknown): GraphicalViewPanelMessage | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const keys = Object.keys(value).sort();
    if ((value.type === 'ready' || value.type === 'refresh') && keys.length === 1) {
        return value as {type: 'ready'} | {type: 'refresh'};
    }
    if (value.type === 'rendered'
        && hasExactKeys(keys, ['type', 'version'])
        && isDisplayedVersion(value.version)) {
        return value as {type: 'rendered'; version: number};
    }
    if (value.type === 'renderError'
        && hasExactKeys(keys, ['reason', 'type', 'version'])
        && value.reason === 'xmlParsingFailed'
        && isDisplayedVersion(value.version)) {
        return value as {type: 'renderError'; version: number; reason: 'xmlParsingFailed'};
    }
    if (value.type === 'navigate'
        && hasExactKeys(keys, ['targetId', 'type', 'version'])
        && isDisplayedVersion(value.version)
        && typeof value.targetId === 'string'
        && GRAPHICAL_VIEW_MARKER_PATTERN.test(value.targetId)) {
        return value as {type: 'navigate'; version: number; targetId: string};
    }
    return undefined;
}

function isDisplayedVersion(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function hasExactKeys(actualKeys: readonly string[], expectedKeys: readonly string[]): boolean {
    return actualKeys.length === expectedKeys.length && actualKeys.every((key, index) => key === expectedKeys[index]);
}
