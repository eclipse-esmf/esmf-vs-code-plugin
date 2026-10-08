/*
 * Copyright (c) 2026 Robert Bosch Manufacturing Solutions GmbH
 * SPDX-License-Identifier: MPL-2.0
 */

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import {findReusableTextEditorViewColumn} from '../graphicalView';
import {resolveGraphicalViewNavigation, validateGraphicalViewResolveResult} from '../graphicalViewNavigation';
import type {GraphicalViewRenderResult} from '../graphicalViewProtocol';
import {
    createGraphicalViewDocument,
    createGraphicalViewHarness,
    flushPromises,
    openGraphicalView,
} from './graphicalViewTestHarness';

const OWNER = 'urn:samm:example.graphical:1.0.0#Aspect';
const PREDICATE = 'urn:samm:org.eclipse.esmf.samm:meta-model:2.2.0#description';

suite('Graphical View source navigation', () => {
    test('dispatches trusted element and language-qualified attribute locators to distinct LSP methods', async () => {
        const harness = createGraphicalViewHarness();
        const cancellation = new vscode.CancellationTokenSource();
        harness.client.resolveResult = {location: null, warning: 'notFound'};

        await resolveGraphicalViewNavigation(
            harness.client,
            'file:///tmp/source.ttl',
            {id: 'gv-header-aaaaaaaaaaaaaaaa', kind: 'elementHeader', elementUrn: OWNER},
            cancellation.token,
        );
        await resolveGraphicalViewNavigation(
            harness.client,
            'file:///tmp/source.ttl',
            {
                id: 'gv-attribute-bbbbbbbbbbbbbbbb',
                kind: 'attributeRow',
                ownerUrn: OWNER,
                predicateUrn: PREDICATE,
                selection: 'singleOccurrence',
                language: 'de',
            },
            cancellation.token,
        );

        assert.deepEqual(harness.client.resolveRequests[0].params, {
            sourceUri: 'file:///tmp/source.ttl',
            elementUrn: OWNER,
        });
        assert.deepEqual(harness.client.attributeResolveRequests[0].params, {
            sourceUri: 'file:///tmp/source.ttl',
            ownerUrn: OWNER,
            predicateUrn: PREDICATE,
            selection: 'singleOccurrence',
            language: 'de',
        });
        cancellation.dispose();
        harness.controller.dispose();
    });

    test('validates local file locations and rejects invalid ranges, remote URIs, and ambiguous result shapes', () => {
        const valid = validateGraphicalViewResolveResult({
            location: {
                uri: vscode.Uri.file('/tmp/target.ttl').toString(),
                range: {start: {line: 3, character: 4}, end: {line: 5, character: 6}},
            },
        });
        assert.equal(valid.kind, 'location');
        assert.deepEqual(valid.kind === 'location' && valid.range, new vscode.Range(3, 4, 5, 6));

        const invalid = [
            {location: {uri: 'https://example.invalid/model.ttl', range: positions(0, 0, 0, 1)}},
            {location: {uri: vscode.Uri.file('/tmp/model.ttl').toString(), range: positions(2, 0, 1, 0)}},
            {location: null, warning: null},
            {location: {uri: vscode.Uri.file('/tmp/model.ttl').toString(), range: positions(0, 0, 0, 1)}, warning: 'notFound'},
            {location: null, warning: 'unknown'},
        ];
        assert.ok(invalid.every(candidate => validateGraphicalViewResolveResult(candidate).kind === 'warning'));
    });

    test('finds visible and hidden regular text tabs while ignoring diff and custom inputs', () => {
        const target = vscode.Uri.file('/tmp/reused.ttl');
        const groups = [
            tabGroup(vscode.ViewColumn.One, [
                tab(new vscode.TabInputTextDiff(vscode.Uri.file('/tmp/original.ttl'), target), true),
                tab(new vscode.TabInputCustom(target, 'test.customEditor'), false),
            ]),
            tabGroup(vscode.ViewColumn.Two, [
                tab(new vscode.TabInputText(target), false),
                tab(new vscode.TabInputText(vscode.Uri.file('/tmp/visible.ttl')), true),
            ]),
        ];

        assert.equal(findReusableTextEditorViewColumn(target, groups), vscode.ViewColumn.Two);
    });

    test('uses complete canonical URI identity and rejects similar resource identifiers', () => {
        const target = vscode.Uri.parse('file://server/tmp/a%20model.ttl?revision=1#definition');
        const groups = [
            tabGroup(vscode.ViewColumn.One, [
                tab(new vscode.TabInputText(vscode.Uri.parse('untitled://server/tmp/a%20model.ttl?revision=1#definition')), false),
                tab(new vscode.TabInputText(vscode.Uri.parse('file://other/tmp/a%20model.ttl?revision=1#definition')), false),
                tab(new vscode.TabInputText(vscode.Uri.parse('file://server/tmp/a%20model.ttl?revision=2#definition')), false),
                tab(new vscode.TabInputText(vscode.Uri.parse('file://server/tmp/a%20model.ttl?revision=1#other')), false),
                tab(new vscode.TabInputText(vscode.Uri.parse('file://server/tmp/a%2520model.ttl?revision=1#definition')), false),
            ]),
            tabGroup(vscode.ViewColumn.Three, [tab(new vscode.TabInputText(vscode.Uri.parse(target.toString())), false)]),
        ];

        assert.equal(findReusableTextEditorViewColumn(target, groups), vscode.ViewColumn.Three);
    });

    test('prefers an active duplicate match and otherwise keeps stable group order', () => {
        const target = vscode.Uri.file('/tmp/duplicate.ttl');
        assert.equal(
            findReusableTextEditorViewColumn(target, [
                tabGroup(vscode.ViewColumn.One, [tab(new vscode.TabInputText(target), false)]),
                tabGroup(vscode.ViewColumn.Two, [tab(new vscode.TabInputText(target), true)]),
                tabGroup(vscode.ViewColumn.Three, [tab(new vscode.TabInputText(target), true)]),
            ]),
            vscode.ViewColumn.Two,
        );
        assert.equal(
            findReusableTextEditorViewColumn(target, [
                tabGroup(vscode.ViewColumn.One, [tab(new vscode.TabInputText(target), false)]),
                tabGroup(vscode.ViewColumn.Two, [tab(new vscode.TabInputText(target), false)]),
            ]),
            vscode.ViewColumn.One,
        );
    });

    test('reuses a matching tab group and preserves fallback, selection, and centered reveal', async () => {
        const harness = createGraphicalViewHarness();
        const document = createGraphicalViewDocument('/tmp/reuse-controller.ttl');
        harness.workspace.available.add(document.uri.toString());
        await openGraphicalView(harness, document);
        const id = successfulHeaderId();
        harness.client.requests[0].deferred.resolve(headerResult(document, id));
        await flushPromises();
        harness.client.resolveResult = {
            location: {uri: document.uri.toString(), range: positions(4, 2, 4, 9)},
        };
        harness.window.tabGroups.all = [
            tabGroup(vscode.ViewColumn.Three, [tab(new vscode.TabInputText(document.uri), false)]) as vscode.TabGroup,
        ];

        harness.panels.panels[0].emitMessage({type: 'navigate', version: 1, targetId: id});
        await flushPromises();
        assert.deepEqual(harness.window.openedEditors[0].options, {preview: false, viewColumn: vscode.ViewColumn.Three});
        assert.ok(harness.window.openedEditors[0].editor.selection.isEqual(new vscode.Selection(4, 2, 4, 9)));
        assert.deepEqual(harness.window.openedEditors[0].revealedRanges, [new vscode.Range(4, 2, 4, 9)]);
        assert.deepEqual(harness.window.openedEditors[0].revealTypes, [vscode.TextEditorRevealType.InCenterIfOutsideViewport]);

        harness.window.tabGroups.all = [];
        harness.panels.panels[0].emitMessage({type: 'navigate', version: 1, targetId: id});
        await flushPromises();
        assert.deepEqual(harness.window.openedEditors[1].options, {preview: false});
        harness.controller.dispose();
    });

    test('does not select or reveal when navigation becomes stale while editor reveal is pending', async () => {
        const harness = createGraphicalViewHarness();
        const document = createGraphicalViewDocument('/tmp/stale-reuse.ttl');
        harness.workspace.available.add(document.uri.toString());
        await openGraphicalView(harness, document);
        const id = successfulHeaderId();
        harness.client.requests[0].deferred.resolve(headerResult(document, id));
        await flushPromises();
        harness.client.resolveResult = {
            location: {uri: document.uri.toString(), range: positions(1, 2, 1, 7)},
        };
        let resolveEditor!: (editor: vscode.TextEditor) => void;
        harness.window.showTextDocumentPromise = new Promise(resolve => {
            resolveEditor = resolve;
        });
        const revealed: vscode.Range[] = [];
        const editor = {
            selection: new vscode.Selection(0, 0, 0, 0),
            revealRange: (range: vscode.Range) => revealed.push(range),
        } as unknown as vscode.TextEditor;

        harness.panels.panels[0].emitMessage({type: 'navigate', version: 1, targetId: id});
        await flushPromises();
        harness.panels.panels[0].dispose();
        resolveEditor(editor);
        await flushPromises();

        assert.ok(editor.selection.isEqual(new vscode.Selection(0, 0, 0, 0)));
        assert.deepEqual(revealed, []);
        harness.controller.dispose();
    });

    test('resolver warnings do not inspect tabs or open an editor', async () => {
        const harness = createGraphicalViewHarness();
        const document = createGraphicalViewDocument('/tmp/not-found-before-tabs.ttl');
        harness.workspace.available.add(document.uri.toString());
        await openGraphicalView(harness, document);
        const id = successfulHeaderId();
        harness.client.requests[0].deferred.resolve(headerResult(document, id));
        await flushPromises();
        harness.client.resolveResult = {location: null, warning: 'notFound'};

        harness.panels.panels[0].emitMessage({type: 'navigate', version: 1, targetId: id});
        await flushPromises();

        assert.deepEqual(harness.window.warnings, ['The graphical target no longer exists in the current model.']);
        assert.deepEqual(harness.window.openedEditors, []);
        harness.controller.dispose();
    });

    test('opens current multilingual and wrapped attribute targets using only the accepted sidecar', async () => {
        const harness = createGraphicalViewHarness();
        const document = createGraphicalViewDocument('/tmp/navigation.ttl');
        harness.workspace.available.add(document.uri.toString());
        await openGraphicalView(harness, document);
        const ids = [
            'gv-attribute-aaaaaaaaaaaaaaaa',
            'gv-attribute-bbbbbbbbbbbbbbbb',
            'gv-attribute-cccccccccccccccc',
        ];
        const result: GraphicalViewRenderResult = {
            uri: document.uri.toString(),
            svg: `<svg>${ids.map(id => `<g id="${id}"><text>row</text></g>`).join('')}</svg>`,
            targets: [
                {id: ids[0], kind: 'attributeRow', ownerUrn: OWNER, predicateUrn: PREDICATE, selection: 'singleOccurrence', language: 'de'},
                {id: ids[1], kind: 'attributeRow', ownerUrn: OWNER, predicateUrn: PREDICATE, selection: 'singleOccurrence', language: 'en'},
                {id: ids[2], kind: 'attributeRow', ownerUrn: OWNER, predicateUrn: PREDICATE, selection: 'predicateStart'},
            ],
            warnings: [],
        };
        harness.client.requests[0].deferred.resolve(result);
        await flushPromises();
        harness.client.resolveResult = {
            location: {uri: document.uri.toString(), range: positions(8, 3, 8, 11)},
        };

        for (const id of ids) {
            harness.panels.panels[0].emitMessage({type: 'navigate', version: 1, targetId: id});
            await flushPromises();
            await flushPromises();
        }

        assert.deepEqual(harness.client.attributeResolveRequests.map(request => request.params.language), ['de', 'en', undefined]);
        assert.deepEqual(harness.client.attributeResolveRequests.map(request => request.params.selection), [
            'singleOccurrence',
            'singleOccurrence',
            'predicateStart',
        ]);
        assert.equal(harness.window.openedEditors.length, 3);
        assert.ok(harness.window.openedEditors.every(opened => opened.editor.selection.isEqual(new vscode.Selection(8, 3, 8, 11))));
        harness.controller.dispose();
    });

    test('rejects stale, fake, malformed, extra-field, warning, non-file, and editor-open paths', async () => {
        const harness = createGraphicalViewHarness();
        const document = createGraphicalViewDocument('/tmp/rejected.ttl');
        harness.workspace.available.add(document.uri.toString());
        await openGraphicalView(harness, document);
        const id = 'gv-header-aaaaaaaaaaaaaaaa';
        harness.client.requests[0].deferred.resolve({
            uri: document.uri.toString(),
            svg: `<svg><g id="${id}"/></svg>`,
            targets: [{id, kind: 'elementHeader', elementUrn: OWNER}],
            warnings: [],
        });
        await flushPromises();

        for (const message of [
            {type: 'navigate', targetId: id},
            {type: 'navigate', version: 2, targetId: id},
            {type: 'navigate', version: 1, targetId: 'gv-header-bbbbbbbbbbbbbbbb'},
            {type: 'navigate', version: 1, targetId: id, elementUrn: OWNER},
        ]) {
            harness.panels.panels[0].emitMessage(message);
        }
        assert.equal(harness.client.resolveRequests.length, 0);

        harness.client.resolveResult = {location: null, warning: 'ambiguous'};
        harness.panels.panels[0].emitMessage({type: 'navigate', version: 1, targetId: id});
        await flushPromises();
        harness.client.resolveResult = {location: {uri: 'https://example.invalid/model.ttl', range: positions(0, 0, 0, 1)}};
        harness.panels.panels[0].emitMessage({type: 'navigate', version: 1, targetId: id});
        await flushPromises();
        harness.client.resolveResult = {location: {uri: document.uri.toString(), range: positions(0, 0, 0, 1)}};
        harness.window.showTextDocumentFailure = new Error('hostile detail');
        harness.panels.panels[0].emitMessage({type: 'navigate', version: 1, targetId: id});
        await flushPromises();
        await flushPromises();

        assert.equal(harness.window.openedEditors.length, 0);
        assert.equal(harness.window.warnings.length, 3);
        assert.ok(harness.window.warnings.every(message => !message.includes('hostile')));
        harness.controller.dispose();
    });
});

function positions(startLine: number, startCharacter: number, endLine: number, endCharacter: number) {
    return {
        start: {line: startLine, character: startCharacter},
        end: {line: endLine, character: endCharacter},
    };
}

function tab(input: unknown, isActive: boolean): Pick<vscode.Tab, 'input' | 'isActive'> {
    return {input, isActive};
}

function tabGroup(
    viewColumn: vscode.ViewColumn,
    tabs: Array<Pick<vscode.Tab, 'input' | 'isActive'>>,
): Pick<vscode.TabGroup, 'viewColumn' | 'tabs'> {
    return {viewColumn, tabs: tabs as vscode.Tab[]};
}

function successfulHeaderId(): string {
    return 'gv-header-aaaaaaaaaaaaaaaa';
}

function headerResult(document: ReturnType<typeof createGraphicalViewDocument>, id: string): GraphicalViewRenderResult {
    return {
        uri: document.uri.toString(),
        svg: `<svg><g id="${id}"/></svg>`,
        targets: [{id, kind: 'elementHeader', elementUrn: OWNER}],
        warnings: [],
    };
}
