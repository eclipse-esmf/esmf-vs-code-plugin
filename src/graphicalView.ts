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
import type {ExtensionLogger} from './outputChannel';
import type {GraphicalViewClient} from './graphicalViewClient';
import {resolveGraphicalViewNavigation} from './graphicalViewNavigation';
import {
    GraphicalViewPanel,
    GraphicalViewPanelFactory,
    GraphicalViewStatus,
    parseGraphicalViewPanelMessage,
} from './graphicalViewPanel';
import type {GraphicalViewRenderResult, GraphicalViewRenderWarning, GraphicalViewTarget} from './graphicalViewProtocol';
import {AcceptedGraphicalViewResult, acceptGraphicalViewResult, isGraphicalViewRenderResult} from './graphicalViewResult';

export const OPEN_GRAPHICAL_VIEW_COMMAND = 'semantic-models.openGraphicalView';

export interface GraphicalViewDocument {
    readonly languageId: string;
    readonly uri: vscode.Uri;
}

export interface GraphicalViewWindow {
    readonly activeTextEditor: {readonly document: GraphicalViewDocument} | undefined;
    readonly tabGroups: {
        readonly all: readonly GraphicalViewTabGroup[];
    };
    showWarningMessage(message: string): Thenable<unknown>;
    showTextDocument(uri: vscode.Uri, options?: vscode.TextDocumentShowOptions): Thenable<vscode.TextEditor>;
}

export interface GraphicalViewTabGroup {
    readonly viewColumn: vscode.ViewColumn;
    readonly tabs: readonly {
        readonly input: unknown;
        readonly isActive: boolean;
    }[];
}

export function findReusableTextEditorViewColumn(
    uri: vscode.Uri,
    groups: readonly GraphicalViewTabGroup[],
): vscode.ViewColumn | undefined {
    const canonicalUri = uri.toString();
    let firstMatchingColumn: vscode.ViewColumn | undefined;
    for (const group of groups) {
        for (const tab of group.tabs) {
            if (!(tab.input instanceof vscode.TabInputText) || tab.input.uri.toString() !== canonicalUri) {
                continue;
            }
            if (tab.isActive) {
                return group.viewColumn;
            }
            firstMatchingColumn ??= group.viewColumn;
        }
    }
    return firstMatchingColumn;
}

export interface GraphicalViewWorkspace {
    onDidSaveTextDocument(listener: (document: GraphicalViewDocument) => void): vscode.Disposable;
    onDidChangeDocumentAvailability(listener: (sourceUri: string, available: boolean) => void): vscode.Disposable;
    isDocumentAvailable(uri: string): boolean;
}

export interface GraphicalViewCommands {
    registerCommand(command: string, callback: () => unknown): vscode.Disposable;
}

interface PanelState {
    readonly sourceUri: string;
    readonly panel: GraphicalViewPanel;
    readonly subscriptions: vscode.Disposable[];
    sequence: number;
    sourceAvailable: boolean;
    visible: boolean;
    disposed: boolean;
    cancellation: vscode.CancellationTokenSource | undefined;
    navigationCancellation: vscode.CancellationTokenSource | undefined;
    nextDisplayVersion: number;
    status: GraphicalViewStatus;
    lastSuccess: AcceptedGraphicalViewResult | undefined;
    pendingDelivery: PendingDelivery | undefined;
}

interface PendingDelivery {
    readonly accepted: AcceptedGraphicalViewResult;
    readonly requestSequence: number;
}

const DISCONNECTED_STATUS: GraphicalViewStatus = Object.freeze({
    kind: 'disconnected',
    message: 'The Turtle language server is disconnected. Reconnect and use Refresh to try again.',
});

export class GraphicalViewController implements vscode.Disposable {
    private readonly panels = new Map<string, PanelState>();
    private readonly subscriptions: vscode.Disposable[] = [];
    private clientSubscription: vscode.Disposable | undefined;
    private registered = false;
    private disposed = false;

    constructor(
        private client: GraphicalViewClient | undefined,
        private readonly panelFactory: GraphicalViewPanelFactory,
        private readonly commands: GraphicalViewCommands,
        private readonly window: GraphicalViewWindow,
        private readonly workspace: GraphicalViewWorkspace,
        private readonly outputChannel: ExtensionLogger,
    ) {
        this.subscribeToClient();
    }

    register(context: Pick<vscode.ExtensionContext, 'subscriptions'>): void {
        if (this.registered || this.disposed) {
            return;
        }
        this.registered = true;
        this.subscriptions.push(
            this.commands.registerCommand(OPEN_GRAPHICAL_VIEW_COMMAND, () => this.openActiveDocument()),
            this.workspace.onDidSaveTextDocument(document => this.handleSave(document)),
            this.workspace.onDidChangeDocumentAvailability((sourceUri, available) =>
                this.handleDocumentAvailability(sourceUri, available),
            ),
        );
        context.subscriptions.push(this);
    }

    setClient(client: GraphicalViewClient | undefined): void {
        if (this.disposed) {
            return;
        }
        this.clientSubscription?.dispose();
        this.clientSubscription = undefined;
        this.client = client;
        for (const state of this.panels.values()) {
            this.invalidate(state);
            this.setStatus(state, client?.isAvailable() ? availableAgainStatus(state) : DISCONNECTED_STATUS);
        }
        this.subscribeToClient();
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.clientSubscription?.dispose();
        this.clientSubscription = undefined;
        for (const subscription of this.subscriptions.splice(0)) {
            subscription.dispose();
        }
        for (const state of [...this.panels.values()]) {
            this.disposePanelState(state, true);
        }
    }

    private async openActiveDocument(): Promise<void> {
        const document = this.window.activeTextEditor?.document;
        if (!document || document.languageId !== 'turtle') {
            await this.window.showWarningMessage('Open a Turtle file before opening the graphical view.');
            return;
        }

        const sourceUri = document.uri.toString();
        const existing = this.panels.get(sourceUri);
        if (existing && !existing.disposed) {
            existing.panel.reveal();
            return;
        }

        const panel = this.panelFactory.create(sourceUri);
        const state: PanelState = {
            sourceUri,
            panel,
            subscriptions: [],
            sequence: 0,
            sourceAvailable: this.workspace.isDocumentAvailable(sourceUri),
            visible: panel.visible,
            disposed: false,
            cancellation: undefined,
            navigationCancellation: undefined,
            nextDisplayVersion: 0,
            status: Object.freeze({kind: 'loading', message: 'Preparing graphical view...'}),
            lastSuccess: undefined,
            pendingDelivery: undefined,
        };
        this.panels.set(sourceUri, state);
        state.subscriptions.push(
            panel.onDidDispose(() => this.disposePanelState(state, false)),
            panel.onDidChangeVisibility(visible => this.handleVisibilityChange(state, visible)),
            panel.onDidReceiveMessage(message => this.handlePanelMessage(state, message)),
        );
        void this.requestRender(state, 'initial');
    }

    private subscribeToClient(): void {
        if (!this.client || this.disposed) {
            return;
        }
        this.clientSubscription = this.client.onDidChangeAvailability(available => this.handleClientAvailability(available));
    }

    private handleClientAvailability(available: boolean): void {
        for (const state of this.panels.values()) {
            if (!available) {
                this.invalidate(state);
                this.setStatus(state, DISCONNECTED_STATUS);
            } else {
                this.setStatus(state, availableAgainStatus(state));
            }
        }
    }

    private handleSave(document: GraphicalViewDocument): void {
        const state = this.panels.get(document.uri.toString());
        if (!state || state.disposed) {
            return;
        }
        if (!state.visible) {
            this.invalidate(state);
            this.setStatus(state, retainedAfterHiddenSaveStatus(state));
            return;
        }
        void this.requestRender(state, 'save');
    }

    private handleDocumentAvailability(sourceUri: string, available: boolean): void {
        const state = this.panels.get(sourceUri);
        if (!state || state.disposed || state.sourceAvailable === available) {
            return;
        }
        state.sourceAvailable = available;
        if (available) {
            return;
        }
        this.invalidate(state);
        this.setStatus(state, retainedAfterSourceLossStatus(state));
    }

    private handleVisibilityChange(state: PanelState, visible: boolean): void {
        if (!this.isCurrent(state)) {
            return;
        }
        state.visible = visible;
        if (visible) {
            this.deliverStatus(state);
        }
    }

    private handlePanelMessage(state: PanelState, value: unknown): void {
        if (!this.isCurrent(state)) {
            return;
        }
        const message = parseGraphicalViewPanelMessage(value);
        if (!message) {
            return;
        }
        switch (message.type) {
            case 'ready':
                this.deliverCurrentState(state);
                return;
            case 'refresh':
                if (state.visible) {
                    void this.requestRender(state, 'manual');
                }
                return;
            case 'rendered':
                this.handleRendered(state, message.version);
                return;
            case 'renderError':
                this.handleRenderError(state, message.version);
                return;
            case 'navigate':
                void this.navigateToTarget(state, message.version, message.targetId);
        }
    }

    private async requestRender(state: PanelState, trigger: 'initial' | 'manual' | 'save'): Promise<void> {
        if (!this.isCurrent(state)) {
            return;
        }
        this.cancelRender(state);
        const sequence = ++state.sequence;
        const sourceUri = state.sourceUri;
        state.sourceAvailable = this.workspace.isDocumentAvailable(sourceUri);
        if (!state.sourceAvailable) {
            this.setStale(
                state,
                'sourceUnavailable',
                'The source document is not available to the language server. Reopen it and use Refresh.',
            );
            return;
        }

        const client = this.client;
        if (!client?.isAvailable()) {
            this.setStatus(state, DISCONNECTED_STATUS);
            return;
        }

        const cancellation = new vscode.CancellationTokenSource();
        state.cancellation = cancellation;
        this.setStatus(state, Object.freeze({kind: 'loading', message: `Rendering graphical view (${trigger})...`}));
        try {
            let attributeRowsAvailable = true;
            let result: GraphicalViewRenderResult;
            try {
                result = await client.render({uri: sourceUri, includeAttributeRows: true}, cancellation.token);
            } catch (error) {
                if (!isInvalidParams(error) || !this.isCurrentRequest(state, sourceUri, sequence, cancellation)) {
                    throw error;
                }
                attributeRowsAvailable = false;
                result = await client.render({uri: sourceUri}, cancellation.token);
            }
            if (!this.isCurrentRequest(state, sourceUri, sequence, cancellation)) {
                return;
            }
            state.cancellation = undefined;
            cancellation.dispose();
            this.handleRenderResult(state, result, sequence, attributeRowsAvailable);
        } catch (error) {
            if (!this.isCurrentRequest(state, sourceUri, sequence, cancellation)) {
                return;
            }
            state.cancellation = undefined;
            cancellation.dispose();
            this.handleRenderFailure(state, error);
        }
    }

    private handleRenderResult(
        state: PanelState,
        result: unknown,
        requestSequence: number,
        attributeRowsAvailable: boolean,
    ): void {
        if (!isGraphicalViewRenderResult(result)) {
            this.setStale(state, 'invalidResponse', 'The language server returned an invalid graphical-view response.');
            return;
        }
        if (result.uri !== state.sourceUri) {
            this.setStale(state, 'uriMismatch', 'The language server returned a graphical view for a different source document.');
            return;
        }
        if (!attributeRowsAvailable && result.targets.some(target => target.kind !== 'elementHeader')) {
            this.setStale(state, 'invalidResponse', 'The legacy language server returned an invalid graphical-view response.');
            return;
        }
        if (result.svg === undefined || result.svg === null) {
            this.handleWarningResult(state, result.warnings);
            return;
        }

        const accepted = acceptGraphicalViewResult(result, ++state.nextDisplayVersion, attributeRowsAvailable);
        state.pendingDelivery = Object.freeze({accepted, requestSequence});
        state.panel.deliver(Object.freeze({type: 'render', version: accepted.version, svg: accepted.svg}));
    }

    private handleRendered(state: PanelState, version: number): void {
        const pending = state.pendingDelivery;
        if (pending?.accepted.version !== version) {
            return;
        }
        this.cancelNavigation(state);
        state.lastSuccess = pending.accepted;
        state.pendingDelivery = undefined;
        if (state.sequence === pending.requestSequence) {
            this.setStatus(state, Object.freeze({
                kind: 'ready',
                message: pending.accepted.attributeRowsAvailable
                    ? 'Graphical view is up to date.'
                    : 'The server supports header navigation only; attribute-row navigation is unavailable.',
            }));
        }
    }

    private handleRenderError(state: PanelState, version: number): void {
        if (state.pendingDelivery?.accepted.version === version) {
            state.pendingDelivery = undefined;
        } else if (state.lastSuccess?.version !== version) {
            return;
        }
        this.outputChannel.warn('Graphical view rejected an SVG payload at the strict XML rendering boundary.');
        this.setStale(
            state,
            'xmlParsingFailed',
            'The new diagram is not a usable SVG document. The last successful diagram is retained.',
        );
    }

    private async navigateToTarget(state: PanelState, version: number, targetId: string): Promise<void> {
        const accepted = state.lastSuccess;
        const target = accepted?.version === version ? accepted.targetById.get(targetId) : undefined;
        if (!accepted || !target) {
            return;
        }

        const client = this.client;
        if (!client?.isAvailable()) {
            await this.window.showWarningMessage(
                'The graphical target is temporarily unavailable because the language server is disconnected.',
            );
            return;
        }

        this.cancelNavigation(state);
        const cancellation = new vscode.CancellationTokenSource();
        state.navigationCancellation = cancellation;
        try {
            const resolution = await resolveGraphicalViewNavigation(client, state.sourceUri, target, cancellation.token);
            if (!this.isCurrentNavigation(state, accepted, target, cancellation)) {
                return;
            }
            state.navigationCancellation = undefined;
            cancellation.dispose();
            if (resolution.kind === 'warning') {
                await this.window.showWarningMessage(resolution.message);
                return;
            }

            try {
                const viewColumn = findReusableTextEditorViewColumn(resolution.uri, this.window.tabGroups.all);
                const options: vscode.TextDocumentShowOptions = viewColumn === undefined
                    ? {preview: false}
                    : {preview: false, viewColumn};
                const editor = await this.window.showTextDocument(resolution.uri, options);
                if (!this.isCurrentNavigationResult(state, accepted, target)) {
                    return;
                }
                editor.selection = new vscode.Selection(resolution.range.start, resolution.range.end);
                editor.revealRange(resolution.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
            } catch (_error) {
                await this.window.showWarningMessage('The graphical target could not be opened in an editor.');
            }
        } catch (_error) {
            if (this.isCurrentNavigation(state, accepted, target, cancellation)) {
                state.navigationCancellation = undefined;
                cancellation.dispose();
                await this.window.showWarningMessage('The graphical target is temporarily unavailable.');
            }
        }
    }

    private isCurrentNavigation(
        state: PanelState,
        accepted: AcceptedGraphicalViewResult,
        target: Readonly<GraphicalViewTarget>,
        cancellation: vscode.CancellationTokenSource,
    ): boolean {
        return state.navigationCancellation === cancellation && this.isCurrentNavigationResult(state, accepted, target);
    }

    private isCurrentNavigationResult(
        state: PanelState,
        accepted: AcceptedGraphicalViewResult,
        target: Readonly<GraphicalViewTarget>,
    ): boolean {
        return this.isCurrent(state)
            && state.lastSuccess === accepted
            && accepted.targetById.get(target.id) === target;
    }

    private handleWarningResult(state: PanelState, warnings: readonly GraphicalViewRenderWarning[]): void {
        const warning = warnings[0];
        switch (warning) {
            case 'timeout':
                this.setStale(state, warning, 'Graphical rendering timed out. The last successful diagram is retained.');
                return;
            case 'modelTooLarge':
                this.setStale(state, warning, 'The model is too large for graphical rendering. The last successful diagram is retained.');
                return;
            case 'missingDocument':
                this.setStale(state, warning, 'The source document is unavailable. The last successful diagram is retained.');
                return;
            case 'unsupportedUri':
                this.setStale(state, warning, 'The source URI is not supported for graphical rendering.');
                return;
            case 'temporarilyUnresolvable':
            default:
                this.setStale(state, warning ?? 'renderFailure', 'The model could not be loaded or parsed. The last successful diagram is retained.');
        }
    }

    private handleRenderFailure(state: PanelState, error: unknown): void {
        if (isMethodNotFound(error)) {
            this.setStatus(state, Object.freeze({
                kind: 'unsupported',
                message: 'Graphical view is not supported by the current server build. The last successful diagram is retained.',
            }));
            return;
        }
        const reason = classifyFailure(error instanceof Error ? error.message : String(error));
        this.outputChannel.warn(`Graphical view render request failed (${reason}).`);
        this.setStale(state, reason, 'Graphical rendering failed. The last successful diagram is retained.');
    }

    private setStale(state: PanelState, reason: string, message: string): void {
        this.setStatus(state, Object.freeze({kind: 'stale', reason, message}));
    }

    private setStatus(state: PanelState, status: GraphicalViewStatus): void {
        if (!this.isCurrent(state)) {
            return;
        }
        state.status = status;
        this.deliverStatus(state);
    }

    private deliverCurrentState(state: PanelState): void {
        this.deliverStatus(state);
        const accepted = state.pendingDelivery?.accepted ?? state.lastSuccess;
        if (accepted) {
            state.panel.deliver(Object.freeze({type: 'render', version: accepted.version, svg: accepted.svg}));
        }
    }

    private deliverStatus(state: PanelState): void {
        state.panel.deliver(Object.freeze({type: 'status', status: state.status}));
    }

    private invalidate(state: PanelState): void {
        if (!this.isCurrent(state)) {
            return;
        }
        this.cancelRender(state);
        this.cancelNavigation(state);
        state.pendingDelivery = undefined;
        state.sequence += 1;
    }

    private cancelRender(state: PanelState): void {
        const cancellation = state.cancellation;
        state.cancellation = undefined;
        if (cancellation) {
            cancellation.cancel();
            cancellation.dispose();
        }
    }

    private cancelNavigation(state: PanelState): void {
        const cancellation = state.navigationCancellation;
        state.navigationCancellation = undefined;
        if (cancellation) {
            cancellation.cancel();
            cancellation.dispose();
        }
    }

    private isCurrentRequest(
        state: PanelState,
        sourceUri: string,
        sequence: number,
        cancellation: vscode.CancellationTokenSource,
    ): boolean {
        return this.isCurrent(state)
            && state.sourceUri === sourceUri
            && state.sequence === sequence
            && state.cancellation === cancellation;
    }

    private isCurrent(state: PanelState): boolean {
        return !this.disposed && !state.disposed && this.panels.get(state.sourceUri) === state;
    }

    private disposePanelState(state: PanelState, disposePanel: boolean): void {
        if (state.disposed) {
            return;
        }
        this.cancelRender(state);
        this.cancelNavigation(state);
        state.sequence += 1;
        state.disposed = true;
        this.panels.delete(state.sourceUri);
        for (const subscription of state.subscriptions.splice(0)) {
            subscription.dispose();
        }
        if (disposePanel) {
            state.panel.dispose();
        }
    }
}

function availableAgainStatus(state: PanelState): GraphicalViewStatus {
    return Object.freeze({
        kind: 'stale',
        reason: 'clientAvailable',
        message: state.lastSuccess
            ? 'The language server is available again. The retained diagram remains visible; use Refresh to update it.'
            : 'The language server is available. Use Refresh to render the graphical view.',
    });
}

function retainedAfterHiddenSaveStatus(state: PanelState): GraphicalViewStatus {
    return state.lastSuccess
        ? Object.freeze({kind: 'ready', message: 'Showing the retained graphical-view snapshot.'})
        : Object.freeze({
            kind: 'stale',
            reason: 'noSnapshot',
            message: 'No graphical-view snapshot is available. Reveal the panel and use Refresh to render one.',
        });
}

function retainedAfterSourceLossStatus(state: PanelState): GraphicalViewStatus {
    return state.lastSuccess
        ? Object.freeze({kind: 'ready', message: 'Showing the retained graphical-view snapshot.'})
        : Object.freeze({
            kind: 'stale',
            reason: 'sourceUnavailable',
            message: 'The source document is no longer open. Reopen it and use Refresh to render the graphical view.',
        });
}

function isMethodNotFound(error: unknown): boolean {
    return (isRecord(error) && error.code === -32601)
        || (error instanceof Error && /method\s+not\s+found/i.test(error.message));
}

function isInvalidParams(error: unknown): boolean {
    return isRecord(error) && error.code === -32602;
}

function classifyFailure(message: string): string {
    if (/timeout|timed out/i.test(message)) {
        return 'timeout';
    }
    if (/parse|syntax/i.test(message)) {
        return 'parse';
    }
    if (/load/i.test(message)) {
        return 'loading';
    }
    if (/transport|connection|socket/i.test(message)) {
        return 'transport';
    }
    return 'error';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
