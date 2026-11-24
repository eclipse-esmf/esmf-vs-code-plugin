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

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import {LspGraphicalViewClient, GraphicalViewRequestTransport} from '../graphicalViewClient';
import {
    GRAPHICAL_VIEW_RENDER_REQUEST,
    GRAPHICAL_VIEW_RESOLVE_ATTRIBUTE_TARGET_REQUEST,
    GRAPHICAL_VIEW_RESOLVE_TARGET_REQUEST,
    GraphicalViewRenderResult,
    GraphicalViewResolveTargetResult,
} from '../graphicalViewProtocol';
import {modelUri, openModel, renderWhenLoaded, SAMM_CLI_TIMEOUT_MS, SammCliSession, startSammCliSession, TEST_NAMESPACE} from './sammCliTestHarness';

suite('Graphical View typed LSP client', () => {
    test('forwards exact render and resolve methods, parameters, and cancellation token', async () => {
        const transport = new FakeTransport();
        const client = new LspGraphicalViewClient(transport);
        const cancellation = new vscode.CancellationTokenSource();

        await client.render({uri: 'file:///model.ttl', includeAttributeRows: true}, cancellation.token);
        await client.resolveElement(
            {sourceUri: 'file:///model.ttl', elementUrn: 'urn:samm:example:1.0.0#Aspect'},
            cancellation.token,
        );
        await client.resolveAttribute(
            {
                sourceUri: 'file:///model.ttl',
                ownerUrn: 'urn:samm:example:1.0.0#Aspect',
                predicateUrn: 'urn:samm:org.eclipse.esmf.samm:meta-model:2.2.0#description',
                selection: 'singleOccurrence',
                language: 'en',
            },
            cancellation.token,
        );

        assert.deepEqual(transport.requests.map(request => request.method), [
            GRAPHICAL_VIEW_RENDER_REQUEST,
            GRAPHICAL_VIEW_RESOLVE_TARGET_REQUEST,
            GRAPHICAL_VIEW_RESOLVE_ATTRIBUTE_TARGET_REQUEST,
        ]);
        assert.ok(transport.requests.every(request => request.token === cancellation.token));
        assert.deepEqual(transport.requests[0].params, {uri: 'file:///model.ttl', includeAttributeRows: true});
        cancellation.dispose();
    });

    test('exposes transport availability without a second lifecycle state', () => {
        const transport = new FakeTransport();
        const client = new LspGraphicalViewClient(transport);
        const events: boolean[] = [];
        const subscription = client.onDidChangeAvailability(available => events.push(available));

        transport.setAvailable(false);
        transport.setAvailable(true);
        assert.equal(client.isAvailable(), true);
        assert.deepEqual(events, [false, true]);
        subscription.dispose();
    });

    test('preserves omitted and explicit-null JSON wire fields', async () => {
        const transport = new FakeTransport();
        const client = new LspGraphicalViewClient(transport);
        const cancellation = new vscode.CancellationTokenSource();
        transport.renderResult = JSON.parse('{"uri":"file:///model.ttl","svg":null,"targets":[],"warnings":["timeout"]}');
        const render = await client.render({uri: 'file:///model.ttl'}, cancellation.token);
        transport.resolveResult = JSON.parse('{"location":null,"warning":null}');
        const resolve = await client.resolveElement(
            {sourceUri: 'file:///model.ttl', elementUrn: 'urn:samm:example:1.0.0#Aspect'},
            cancellation.token,
        );

        assert.equal(render.svg, null);
        assert.equal(resolve.location, null);
        assert.equal(resolve.warning, null);
        cancellation.dispose();
    });
});

suite('Graphical View typed LSP client (real SAMM CLI)', function () {
    this.timeout(SAMM_CLI_TIMEOUT_MS);
    let session: SammCliSession | undefined;
    let cancellation: vscode.CancellationTokenSource;

    setup(async () => {
        session = await startSammCliSession();
        cancellation = new vscode.CancellationTokenSource();
    });

    teardown(async () => {
        cancellation.dispose();
        await session?.dispose();
        session = undefined;
    });

    test('render and both resolve methods return the wire shapes the extension expects', async () => {
        const client = new LspGraphicalViewClient(session!.client);
        const movement = await openModel('Movement.ttl');
        await renderWhenLoaded(session!.client, movement);

        const render = await client.render({uri: movement.toString(), includeAttributeRows: true}, cancellation.token);
        const element = await client.resolveElement(
            {sourceUri: movement.toString(), elementUrn: `${TEST_NAMESPACE}Movement`},
            cancellation.token,
        );
        const attribute = await client.resolveAttribute(
            {
                sourceUri: movement.toString(),
                ownerUrn: `${TEST_NAMESPACE}Movement`,
                predicateUrn: 'urn:samm:org.eclipse.esmf.samm:meta-model:2.2.0#preferredName',
                selection: 'singleOccurrence',
                language: 'de',
            },
            cancellation.token,
        );

        assert.deepEqual(Object.keys(render).sort(), ['svg', 'targets', 'uri', 'warnings']);
        assert.deepEqual(render.warnings, []);
        for (const resolved of [element, attribute]) {
            assert.deepEqual(Object.keys(resolved), ['location'], JSON.stringify(resolved));
            assert.equal(vscode.Uri.parse(resolved.location!.uri).fsPath, modelUri('Movement.ttl').fsPath);
        }
    });

    test('omits the location field of a resolve warning on the wire', async () => {
        const client = new LspGraphicalViewClient(session!.client);
        const movement = await openModel('Movement.ttl');
        await renderWhenLoaded(session!.client, movement);

        const missing = await client.resolveElement({sourceUri: movement.toString(), elementUrn: `${TEST_NAMESPACE}Missing`}, cancellation.token);

        assert.deepEqual(missing, {warning: 'notFound'});
    });

    test('reports real transport availability without a second lifecycle state', async () => {
        const client = new LspGraphicalViewClient(session!.client);
        const events: boolean[] = [];
        const subscription = client.onDidChangeAvailability(available => events.push(available));
        assert.equal(client.isAvailable(), true);

        await session!.client.disconnect();

        assert.equal(client.isAvailable(), false);
        assert.deepEqual(events, [false]);
        subscription.dispose();
    });
});

class FakeTransport implements GraphicalViewRequestTransport {
    readonly requests: Array<{method: string; params: unknown; token: vscode.CancellationToken | undefined}> = [];
    renderResult: GraphicalViewRenderResult = {uri: 'file:///model.ttl', svg: '<svg/>', targets: [], warnings: []};
    resolveResult: GraphicalViewResolveTargetResult = {location: null, warning: 'notFound'};
    private available = true;
    private readonly listeners = new Set<(available: boolean) => void>();

    isAvailable(): boolean {
        return this.available;
    }

    onDidChangeAvailability(listener: (available: boolean) => void): vscode.Disposable {
        this.listeners.add(listener);
        return new vscode.Disposable(() => this.listeners.delete(listener));
    }

    sendRequest<R>(method: string, params?: unknown, token?: vscode.CancellationToken): Promise<R> {
        this.requests.push({method, params, token});
        return Promise.resolve((method === GRAPHICAL_VIEW_RENDER_REQUEST ? this.renderResult : this.resolveResult) as R);
    }

    setAvailable(available: boolean): void {
        this.available = available;
        for (const listener of [...this.listeners]) {
            listener(available);
        }
    }
}
