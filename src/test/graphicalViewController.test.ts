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
import {OPEN_GRAPHICAL_VIEW_COMMAND} from '../graphicalView';
import {
    FakeGraphicalViewClient,
    createGraphicalViewDocument,
    createGraphicalViewHarness,
    flushPromises,
    lastStatus,
    openGraphicalView,
    renderDeliveries,
    successfulResult,
} from './graphicalViewTestHarness';

suite('GraphicalViewController lifecycle', () => {
    test('guards absent and non-Turtle active editors without creating a panel or request', async () => {
        const harness = createGraphicalViewHarness();
        await harness.commands.execute(OPEN_GRAPHICAL_VIEW_COMMAND);
        harness.window.activeTextEditor = {document: createGraphicalViewDocument('/tmp/not-turtle.txt', 'plaintext')};
        await harness.commands.execute(OPEN_GRAPHICAL_VIEW_COMMAND);

        assert.equal(harness.window.warnings.length, 2);
        assert.equal(harness.panels.panels.length, 0);
        assert.equal(harness.client.requests.length, 0);
        harness.controller.dispose();
    });

    test('creates one panel per canonical URI and renders only on first creation', async () => {
        const harness = createGraphicalViewHarness();
        const first = track(harness, '/tmp/first.ttl');
        const second = track(harness, '/tmp/second.ttl');

        await openGraphicalView(harness, first);
        await openGraphicalView(harness, first);
        await openGraphicalView(harness, second);

        assert.equal(harness.panels.panels.length, 2);
        assert.equal(harness.panels.panels[0].revealCount, 1);
        assert.equal(harness.client.requests.length, 2);
        assert.deepEqual(harness.client.requests.map(request => request.params), [
            {uri: first.uri.toString(), includeAttributeRows: true},
            {uri: second.uri.toString(), includeAttributeRows: true},
        ]);
        harness.controller.dispose();
    });

    test('renders on visible Refresh and bound-main Save but not imported Save or reveal', async () => {
        const harness = createGraphicalViewHarness();
        const main = track(harness, '/tmp/main.ttl');
        const imported = track(harness, '/tmp/import.ttl');
        await openGraphicalView(harness, main);

        harness.panels.panels[0].emitMessage({type: 'refresh'});
        harness.workspace.fireSave(imported);
        await openGraphicalView(harness, main);
        harness.workspace.fireSave(main);

        assert.equal(harness.client.requests.length, 3);
        assert.equal(harness.client.requests[0].token.isCancellationRequested, true);
        assert.equal(harness.client.requests[1].token.isCancellationRequested, true);
        harness.controller.dispose();
    });

    test('hidden main Save invalidates pending work and ready rehydrates without rendering', async () => {
        const harness = createGraphicalViewHarness();
        const document = track(harness, '/tmp/hidden.ttl');
        await openGraphicalView(harness, document);
        harness.client.requests[0].deferred.resolve(successfulResult(document));
        await flushPromises();

        const panel = harness.panels.panels[0];
        panel.emitMessage({type: 'refresh'});
        const pending = harness.client.requests[1];
        panel.setVisible(false);
        harness.workspace.fireSave(document);
        panel.emitMessage({type: 'refresh'});
        panel.setVisible(true);
        const deliveriesBeforeReady = renderDeliveries(panel).length;
        panel.emitMessage({type: 'ready'});

        assert.equal(harness.client.requests.length, 2);
        assert.equal(pending.token.isCancellationRequested, true);
        assert.equal(renderDeliveries(panel).length, deliveriesBeforeReady + 1);
        assert.equal(renderDeliveries(panel).at(-1)?.svg, successfulResult(document).svg);
        assert.equal(lastStatus(panel)?.kind, 'ready');
        harness.controller.dispose();
    });

    test('source closure preserves the panel and last result while invalidating late work', async () => {
        const harness = createGraphicalViewHarness();
        const document = track(harness, '/tmp/closed.ttl');
        await openGraphicalView(harness, document);
        harness.client.requests[0].deferred.resolve(successfulResult(document));
        await flushPromises();
        const panel = harness.panels.panels[0];
        panel.emitMessage({type: 'refresh'});
        const pending = harness.client.requests[1];

        harness.workspace.closeSourceEditor(document);
        pending.deferred.reject(new Error('late transport failure'));
        await flushPromises();
        panel.emitMessage({type: 'ready'});

        assert.equal(harness.panels.panels.length, 1);
        assert.equal(pending.token.isCancellationRequested, true);
        assert.equal(renderDeliveries(panel).at(-1)?.svg, successfulResult(document).svg);
        assert.equal(lastStatus(panel)?.kind, 'ready');
        harness.controller.dispose();
    });

    test('accepts only the newest request and discards obsolete success and failure completions', async () => {
        const harness = createGraphicalViewHarness();
        const document = track(harness, '/tmp/latest.ttl');
        await openGraphicalView(harness, document);
        const first = harness.client.requests[0];
        harness.panels.panels[0].emitMessage({type: 'refresh'});
        const second = harness.client.requests[1];
        harness.panels.panels[0].emitMessage({type: 'refresh'});
        const third = harness.client.requests[2];

        second.deferred.reject(new Error('obsolete failure'));
        first.deferred.resolve(successfulResult(document, '1111111111111111'));
        third.deferred.resolve(successfulResult(document, '3333333333333333'));
        await flushPromises();

        const renders = renderDeliveries(harness.panels.panels[0]);
        assert.equal(renders.length, 1);
        assert.match(renders[0].svg, /3333333333333333/);
        assert.equal(lastStatus(harness.panels.panels[0])?.kind, 'ready');
        harness.controller.dispose();
    });

    test('rejects a URI mismatch without replacing the retained result', async () => {
        const harness = createGraphicalViewHarness();
        const document = track(harness, '/tmp/uri-mismatch.ttl');
        await openGraphicalView(harness, document);
        harness.client.requests[0].deferred.resolve(successfulResult(document));
        await flushPromises();
        harness.panels.panels[0].emitMessage({type: 'refresh'});
        harness.client.requests[1].deferred.resolve({...successfulResult(document), uri: 'file:///tmp/other.ttl'});
        await flushPromises();
        harness.panels.panels[0].emitMessage({type: 'ready'});

        assert.equal(renderDeliveries(harness.panels.panels[0]).at(-1)?.svg, successfulResult(document).svg);
        const status = lastStatus(harness.panels.panels[0]);
        assert.equal(status?.kind, 'stale');
        assert.equal(status?.kind === 'stale' && status.reason, 'uriMismatch');
        harness.controller.dispose();
    });

    test('commits SVG and sidecar only after the secure webview acknowledges it', async () => {
        const harness = createGraphicalViewHarness();
        const document = track(harness, '/tmp/ack.ttl');
        await openGraphicalView(harness, document);
        const panel = harness.panels.panels[0];
        panel.renderOutcome = 'none';
        harness.client.requests[0].deferred.resolve(successfulResult(document));
        await flushPromises();

        panel.emitMessage({type: 'navigate', version: 1, targetId: successfulResult(document).targets[0].id});
        assert.equal(harness.client.resolveRequests.length, 0);
        panel.emitMessage({type: 'rendered', version: 1});
        panel.emitMessage({type: 'navigate', version: 1, targetId: successfulResult(document).targets[0].id});
        await flushPromises();
        assert.equal(harness.client.resolveRequests.length, 1);
        harness.controller.dispose();
    });

    test('retains the last accepted diagram for warning, transport, and XML parsing failures', async () => {
        const harness = createGraphicalViewHarness();
        const document = track(harness, '/tmp/retention.ttl');
        await openGraphicalView(harness, document);
        const retained = successfulResult(document);
        harness.client.requests[0].deferred.resolve(retained);
        await flushPromises();
        const panel = harness.panels.panels[0];

        panel.emitMessage({type: 'refresh'});
        harness.client.requests[1].deferred.resolve({uri: document.uri.toString(), svg: null, targets: [], warnings: ['timeout']});
        await flushPromises();
        panel.emitMessage({type: 'refresh'});
        harness.client.requests[2].deferred.reject(new Error('transport connection failed'));
        await flushPromises();
        panel.renderOutcome = 'failure';
        panel.emitMessage({type: 'refresh'});
        harness.client.requests[3].deferred.resolve(successfulResult(document, 'aaaaaaaaaaaaaaaa'));
        await flushPromises();
        panel.renderOutcome = 'success';
        panel.emitMessage({type: 'ready'});

        assert.equal(renderDeliveries(panel).at(-1)?.svg, retained.svg);
        assert.equal(lastStatus(panel)?.kind, 'stale');
        assert.ok(harness.outputChannel.lines.some(line => line.includes('strict XML rendering boundary')));
        harness.controller.dispose();
    });

    test('falls back once on InvalidParams and exposes header-only compatibility', async () => {
        const harness = createGraphicalViewHarness();
        const document = track(harness, '/tmp/legacy.ttl');
        await openGraphicalView(harness, document);
        harness.client.requests[0].deferred.reject({code: -32602, message: 'Invalid params'});
        await flushPromises();
        harness.client.requests[1].deferred.resolve(successfulResult(document));
        await flushPromises();

        assert.deepEqual(harness.client.requests.map(request => request.params), [
            {uri: document.uri.toString(), includeAttributeRows: true},
            {uri: document.uri.toString()},
        ]);
        assert.match(lastStatus(harness.panels.panels[0])?.message ?? '', /header navigation only/i);
        harness.controller.dispose();
    });

    test('handles MethodNotFound, client replacement, disconnect, and reconnect without automatic rendering', async () => {
        const harness = createGraphicalViewHarness();
        const document = track(harness, '/tmp/lifecycle.ttl');
        await openGraphicalView(harness, document);
        harness.client.requests[0].deferred.reject({code: -32601, message: 'localized'});
        await flushPromises();
        assert.equal(lastStatus(harness.panels.panels[0])?.kind, 'unsupported');

        const replacement = new FakeGraphicalViewClient();
        harness.controller.setClient(replacement);
        replacement.setAvailable(false);
        replacement.setAvailable(true);
        assert.equal(replacement.requests.length, 0);
        assert.equal(lastStatus(harness.panels.panels[0])?.kind, 'stale');

        harness.panels.panels[0].emitMessage({type: 'refresh'});
        assert.equal(replacement.requests.length, 1);
        harness.controller.dispose();
    });

    test('panel disposal cancels work, removes ownership, and rejects late results', async () => {
        const harness = createGraphicalViewHarness();
        const document = track(harness, '/tmp/dispose.ttl');
        await openGraphicalView(harness, document);
        const firstPanel = harness.panels.panels[0];
        const request = harness.client.requests[0];
        firstPanel.dispose();
        request.deferred.resolve(successfulResult(document));
        await flushPromises();
        await openGraphicalView(harness, document);

        assert.equal(request.token.isCancellationRequested, true);
        assert.equal(firstPanel.disposedListenerCount, 3);
        assert.equal(renderDeliveries(firstPanel).length, 0);
        assert.equal(harness.panels.panels.length, 2);
        harness.controller.dispose();
    });

    test('independent panels do not cross-deliver results and controller disposal closes both', async () => {
        const harness = createGraphicalViewHarness();
        const first = track(harness, '/tmp/multi-one.ttl');
        const second = track(harness, '/tmp/multi-two.ttl');
        await openGraphicalView(harness, first);
        await openGraphicalView(harness, second);
        harness.client.requests[1].deferred.resolve(successfulResult(second, 'bbbbbbbbbbbbbbbb'));
        await flushPromises();

        assert.equal(renderDeliveries(harness.panels.panels[0]).length, 0);
        assert.match(renderDeliveries(harness.panels.panels[1])[0].svg, /bbbbbbbbbbbbbbbb/);
        harness.controller.dispose();
        assert.equal(harness.panels.panels[0].disposeCount, 1);
        assert.equal(harness.panels.panels[1].disposeCount, 1);
    });
});

function track(harness: ReturnType<typeof createGraphicalViewHarness>, filePath: string) {
    const document = createGraphicalViewDocument(filePath);
    harness.workspace.available.add(document.uri.toString());
    return document;
}
