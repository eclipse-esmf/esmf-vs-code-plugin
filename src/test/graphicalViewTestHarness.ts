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
import {
    GraphicalViewCommands,
    GraphicalViewController,
    GraphicalViewDocument,
    GraphicalViewWindow,
    GraphicalViewWorkspace,
} from '../graphicalView';
import type {GraphicalViewClient} from '../graphicalViewClient';
import {
    GraphicalViewDelivery,
    GraphicalViewPanel,
    GraphicalViewPanelFactory,
    GraphicalViewStatus,
} from '../graphicalViewPanel';
import {
    GraphicalViewRenderParams,
    GraphicalViewRenderResult,
    GraphicalViewElementHeaderTarget,
    GraphicalViewResolveAttributeTargetParams,
    GraphicalViewResolveAttributeTargetResult,
    GraphicalViewResolveTargetParams,
    GraphicalViewResolveTargetResult,
} from '../graphicalViewProtocol';
import type {ExtensionLogger} from '../outputChannel';

export interface RecordedRenderRequest {
    readonly params: GraphicalViewRenderParams;
    readonly token: vscode.CancellationToken;
    readonly deferred: Deferred<GraphicalViewRenderResult>;
}

export interface RecordedResolveRequest {
    readonly params: GraphicalViewResolveTargetParams;
    readonly token: vscode.CancellationToken | undefined;
}

export interface RecordedAttributeResolveRequest {
    readonly params: GraphicalViewResolveAttributeTargetParams;
    readonly token: vscode.CancellationToken | undefined;
}

export class FakeGraphicalViewClient implements GraphicalViewClient {
    readonly requests: RecordedRenderRequest[] = [];
    readonly resolveRequests: RecordedResolveRequest[] = [];
    readonly attributeResolveRequests: RecordedAttributeResolveRequest[] = [];
    resolveResult: GraphicalViewResolveTargetResult = {location: null, warning: 'temporarilyUnresolvable'};
    resolveFailure: unknown | undefined;
    private readonly listeners = new Set<(available: boolean) => void>();

    constructor(private available = true) {}

    isAvailable(): boolean {
        return this.available;
    }

    onDidChangeAvailability(listener: (available: boolean) => void): vscode.Disposable {
        this.listeners.add(listener);
        return new vscode.Disposable(() => this.listeners.delete(listener));
    }

    render(params: GraphicalViewRenderParams, token: vscode.CancellationToken): Promise<GraphicalViewRenderResult> {
        const deferred = new Deferred<GraphicalViewRenderResult>();
        this.requests.push({params, token, deferred});
        return deferred.promise;
    }

    resolveElement(
        params: GraphicalViewResolveTargetParams,
        token: vscode.CancellationToken,
    ): Promise<GraphicalViewResolveTargetResult> {
        this.resolveRequests.push({params, token});
        return this.resolveFailure === undefined ? Promise.resolve(this.resolveResult) : Promise.reject(this.resolveFailure);
    }

    resolveAttribute(
        params: GraphicalViewResolveAttributeTargetParams,
        token: vscode.CancellationToken,
    ): Promise<GraphicalViewResolveAttributeTargetResult> {
        this.attributeResolveRequests.push({params, token});
        return this.resolveFailure === undefined ? Promise.resolve(this.resolveResult) : Promise.reject(this.resolveFailure);
    }

    setAvailable(available: boolean): void {
        this.available = available;
        for (const listener of [...this.listeners]) {
            listener(available);
        }
    }
}

export class FakeGraphicalViewPanel implements GraphicalViewPanel {
    readonly deliveries: GraphicalViewDelivery[] = [];
    revealCount = 0;
    disposeCount = 0;
    disposedListenerCount = 0;
    renderOutcome: 'success' | 'failure' | 'none' = 'success';
    private readonly disposeListeners = new Set<() => void>();
    private readonly visibilityListeners = new Set<(visible: boolean) => void>();
    private readonly messageListeners = new Set<(message: unknown) => void>();

    constructor(public visible = true) {}

    reveal(): void {
        this.revealCount += 1;
        this.setVisible(true);
    }

    deliver(delivery: GraphicalViewDelivery): void {
        this.deliveries.push(delivery);
        if (delivery.type === 'render' && this.renderOutcome !== 'none') {
            this.emitMessage(
                this.renderOutcome === 'success'
                    ? {type: 'rendered', version: delivery.version}
                    : {type: 'renderError', version: delivery.version, reason: 'xmlParsingFailed'},
            );
        }
    }

    onDidDispose(listener: () => void): vscode.Disposable {
        this.disposeListeners.add(listener);
        return this.listenerDisposable(this.disposeListeners, listener);
    }

    onDidChangeVisibility(listener: (visible: boolean) => void): vscode.Disposable {
        this.visibilityListeners.add(listener);
        return this.listenerDisposable(this.visibilityListeners, listener);
    }

    onDidReceiveMessage(listener: (message: unknown) => void): vscode.Disposable {
        this.messageListeners.add(listener);
        return this.listenerDisposable(this.messageListeners, listener);
    }

    setVisible(visible: boolean): void {
        if (this.visible === visible) {
            return;
        }
        this.visible = visible;
        for (const listener of [...this.visibilityListeners]) {
            listener(visible);
        }
    }

    emitMessage(message: unknown): void {
        for (const listener of [...this.messageListeners]) {
            listener(message);
        }
    }

    dispose(): void {
        if (this.disposeCount > 0) {
            return;
        }
        this.disposeCount += 1;
        for (const listener of [...this.disposeListeners]) {
            listener();
        }
    }

    private listenerDisposable<T>(listeners: Set<T>, listener: T): vscode.Disposable {
        return new vscode.Disposable(() => {
            if (listeners.delete(listener)) {
                this.disposedListenerCount += 1;
            }
        });
    }
}

export class FakeGraphicalViewPanelFactory implements GraphicalViewPanelFactory {
    readonly panels: FakeGraphicalViewPanel[] = [];

    create(_sourceUri: string): FakeGraphicalViewPanel {
        const panel = new FakeGraphicalViewPanel();
        this.panels.push(panel);
        return panel;
    }
}

export function createGraphicalViewHarness(client = new FakeGraphicalViewClient()) {
    return createHarness(client, new FakeWindow());
}

export function createGraphicalViewHarnessWithWindow<TWindow extends GraphicalViewWindow>(
    window: TWindow,
    client = new FakeGraphicalViewClient(),
) {
    return createHarness(client, window);
}

function createHarness<TWindow extends GraphicalViewWindow>(client: FakeGraphicalViewClient, window: TWindow) {
    const panels = new FakeGraphicalViewPanelFactory();
    const commands = new FakeCommands();
    const workspace = new FakeWorkspace();
    const outputChannel = new FakeOutputChannel();
    const controller = new GraphicalViewController(client, panels, commands, window, workspace, outputChannel);
    const context = {subscriptions: [] as vscode.Disposable[]};
    controller.register(context);
    return {client, commands, context, controller, outputChannel, panels, window, workspace};
}

export function createGraphicalViewDocument(filePath: string, languageId = 'turtle'): GraphicalViewDocument {
    return {languageId, uri: vscode.Uri.file(filePath)};
}

export function successfulResult(
    document: GraphicalViewDocument,
    suffix = '0123456789abcdef',
): GraphicalViewRenderResult & {targets: [GraphicalViewElementHeaderTarget]} {
    const id = `gv-header-${suffix}`;
    return {
        uri: document.uri.toString(),
        svg: `<svg><g id="${id}"><text>Aspect</text></g></svg>`,
        targets: [{id, kind: 'elementHeader', elementUrn: 'urn:samm:example.graphical:1.0.0#Aspect'}],
        warnings: [],
    };
}

export async function openGraphicalView(
    harness: ReturnType<typeof createGraphicalViewHarness>,
    document: GraphicalViewDocument,
): Promise<void> {
    harness.window.activeTextEditor = {document};
    await harness.commands.execute('semantic-models.openGraphicalView');
}

export function lastStatus(panel: FakeGraphicalViewPanel): GraphicalViewStatus | undefined {
    return panel.deliveries.filter(delivery => delivery.type === 'status').at(-1)?.status;
}

export function renderDeliveries(panel: FakeGraphicalViewPanel): Array<Extract<GraphicalViewDelivery, {type: 'render'}>> {
    return panel.deliveries.filter((delivery): delivery is Extract<GraphicalViewDelivery, {type: 'render'}> =>
        delivery.type === 'render',
    );
}

export async function flushPromises(): Promise<void> {
    await new Promise<void>(resolve => setImmediate(resolve));
}

class FakeCommands implements GraphicalViewCommands {
    private readonly callbacks = new Map<string, () => unknown>();

    registerCommand(command: string, callback: () => unknown): vscode.Disposable {
        this.callbacks.set(command, callback);
        return new vscode.Disposable(() => this.callbacks.delete(command));
    }

    async execute(command: string): Promise<unknown> {
        return this.callbacks.get(command)?.();
    }
}

export class FakeWindow implements GraphicalViewWindow {
    activeTextEditor: {document: GraphicalViewDocument} | undefined;
    readonly tabGroups: {all: vscode.TabGroup[]} = {all: []};
    readonly warnings: string[] = [];
    readonly openedEditors: Array<{
        uri: vscode.Uri;
        options: vscode.TextDocumentShowOptions | undefined;
        editor: vscode.TextEditor;
        revealedRanges: vscode.Range[];
        revealTypes: Array<vscode.TextEditorRevealType | undefined>;
    }> = [];
    showTextDocumentFailure: unknown | undefined;
    showTextDocumentPromise: Promise<vscode.TextEditor> | undefined;

    showWarningMessage(message: string): Promise<unknown> {
        this.warnings.push(message);
        return Promise.resolve(undefined);
    }

    showTextDocument(uri: vscode.Uri, options?: vscode.TextDocumentShowOptions): Promise<vscode.TextEditor> {
        if (this.showTextDocumentFailure !== undefined) {
            return Promise.reject(this.showTextDocumentFailure);
        }
        if (this.showTextDocumentPromise !== undefined) {
            return this.showTextDocumentPromise;
        }
        const revealedRanges: vscode.Range[] = [];
        const revealTypes: Array<vscode.TextEditorRevealType | undefined> = [];
        const editor = {
            selection: new vscode.Selection(0, 0, 0, 0),
            revealRange: (range: vscode.Range, revealType?: vscode.TextEditorRevealType) => {
                revealedRanges.push(range);
                revealTypes.push(revealType);
            },
        } as unknown as vscode.TextEditor;
        this.openedEditors.push({uri, options, editor, revealedRanges, revealTypes});
        return Promise.resolve(editor);
    }
}

class FakeWorkspace implements GraphicalViewWorkspace {
    readonly available = new Set<string>();
    private saveListener: ((document: GraphicalViewDocument) => void) | undefined;
    private availabilityListener: ((sourceUri: string, available: boolean) => void) | undefined;

    onDidSaveTextDocument(listener: (document: GraphicalViewDocument) => void): vscode.Disposable {
        this.saveListener = listener;
        return new vscode.Disposable(() => {
            if (this.saveListener === listener) {
                this.saveListener = undefined;
            }
        });
    }

    onDidChangeDocumentAvailability(listener: (sourceUri: string, available: boolean) => void): vscode.Disposable {
        this.availabilityListener = listener;
        return new vscode.Disposable(() => {
            if (this.availabilityListener === listener) {
                this.availabilityListener = undefined;
            }
        });
    }

    isDocumentAvailable(uri: string): boolean {
        return this.available.has(uri);
    }

    fireSave(document: GraphicalViewDocument): void {
        this.saveListener?.(document);
    }

    loseDocument(document: GraphicalViewDocument): void {
        this.available.delete(document.uri.toString());
        this.availabilityListener?.(document.uri.toString(), false);
    }

    closeSourceEditor(document: GraphicalViewDocument): void {
        this.available.delete(document.uri.toString());
        this.availabilityListener?.(document.uri.toString(), false);
    }
}

class FakeOutputChannel implements ExtensionLogger {
    readonly lines: string[] = [];
    trace(message: string): void {
        this.lines.push(`[trace] ${message}`);
    }
    debug(message: string): void {
        this.lines.push(`[debug] ${message}`);
    }
    info(message: string): void {
        this.lines.push(`[info] ${message}`);
    }
    warn(message: string): void {
        this.lines.push(`[warn] ${message}`);
    }
    error(message: string | Error): void {
        this.lines.push(`[error] ${message instanceof Error ? message.message : message}`);
    }
}

class Deferred<T> {
    readonly promise: Promise<T>;
    private resolvePromise!: (value: T) => void;
    private rejectPromise!: (reason: unknown) => void;

    constructor() {
        this.promise = new Promise<T>((resolve, reject) => {
            this.resolvePromise = resolve;
            this.rejectPromise = reject;
        });
    }

    resolve(value: T): void {
        this.resolvePromise(value);
    }

    reject(reason: unknown): void {
        this.rejectPromise(reason);
    }
}
