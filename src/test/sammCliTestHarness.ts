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

// Shared helpers for tests that talk to the real SAMM CLI language server (`samm lsp --stdio`).
// .vscode-test.mjs provides the executable via SAMM_CLI_PATH.

import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type {RequestClient} from '../aspectValidation';
import {GRAPHICAL_VIEW_RENDER_REQUEST, GraphicalViewRenderResult} from '../graphicalViewProtocol';
import {TurtleLanguageClient} from '../languageClient';
import {TurtleLanguageServer} from '../languageServer';
import type {ExtensionLogger} from '../outputChannel';

// The real server needs several seconds to start (JVM warm-up).
export const SAMM_CLI_TIMEOUT_MS = 120_000;
export const EXTENSION_ROOT = path.resolve(__dirname, '..', '..');
export const TEST_NAMESPACE = 'urn:samm:org.eclipse.esmf.test:1.0.0#';

const LOAD_TIMEOUT_MS = 30_000;

export const silentLogger: ExtensionLogger = {
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
};

/** Returns the URI of a model in src/test/models/org.eclipse.esmf.test/1.0.0. */
export function modelUri(fileName: string): vscode.Uri {
    return vscode.Uri.file(path.join(EXTENSION_ROOT, 'src', 'test', 'models', 'org.eclipse.esmf.test', '1.0.0', fileName));
}

export function createSammCliServer(executable = process.env.SAMM_CLI_PATH): TurtleLanguageServer {
    assert.ok(executable, 'SAMM_CLI_PATH must point to the SAMM CLI executable (set by .vscode-test.mjs)');
    return new TurtleLanguageServer({extensionPath: EXTENSION_ROOT} as vscode.ExtensionContext, silentLogger, executable, {}, vscode.LogLevel.Off);
}

export interface SammCliSession {
    readonly server: TurtleLanguageServer;
    readonly client: TurtleLanguageClient;
    dispose(): Promise<void>;
}

/** Starts one real server with a connected client; share it across a suite to avoid repeated JVM start-up. */
export async function startSammCliSession(): Promise<SammCliSession> {
    const server = createSammCliServer();
    await server.start();
    const client = new TurtleLanguageClient(silentLogger, server, vscode.LogLevel.Off);
    try {
        await client.connect();
    } catch (error) {
        await server.stop();
        throw error;
    }
    return {
        server,
        client,
        dispose: async () => {
            await client.disconnect().catch(() => undefined);
            await server.stop();
        },
    };
}

/** Opens a model so the connected client sends didOpen to the server. */
export async function openModel(fileName: string): Promise<vscode.Uri> {
    const uri = modelUri(fileName);
    await vscode.workspace.openTextDocument(uri);
    return uri;
}

// The server may answer with a warning instead of an SVG until it has processed the didOpen notification.
export async function renderWhenLoaded(
    client: RequestClient,
    uri: vscode.Uri,
    includeAttributeRows = false,
): Promise<GraphicalViewRenderResult> {
    const deadline = Date.now() + LOAD_TIMEOUT_MS;
    for (;;) {
        const result = await client.sendRequest<GraphicalViewRenderResult>(GRAPHICAL_VIEW_RENDER_REQUEST, {
            uri: uri.toString(),
            includeAttributeRows,
        });
        if (result.svg) {
            return result;
        }
        assert.ok(
            Date.now() < deadline,
            `Timed out waiting for an SVG for ${uri.toString()}; last warnings: ${JSON.stringify(result.warnings)}`,
        );
        await delay(200);
    }
}

/** Waits until the server has published at least one diagnostic for an (invalid) model. */
export async function waitForDiagnostics(uri: vscode.Uri): Promise<vscode.Diagnostic[]> {
    const deadline = Date.now() + LOAD_TIMEOUT_MS;
    for (;;) {
        const diagnostics = vscode.languages.getDiagnostics(uri);
        if (diagnostics.length > 0) {
            return diagnostics;
        }
        assert.ok(Date.now() < deadline, `Timed out waiting for diagnostics on ${uri.toString()}`);
        await delay(200);
    }
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
