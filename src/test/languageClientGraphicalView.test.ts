/*
 * Copyright (c) 2026 Robert Bosch Manufacturing Solutions GmbH
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
