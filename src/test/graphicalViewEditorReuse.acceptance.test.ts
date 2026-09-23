/*
 * Copyright (c) 2026 Robert Bosch Manufacturing Solutions GmbH
 * SPDX-License-Identifier: MPL-2.0
 */

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type {GraphicalViewRenderResult} from '../graphicalViewProtocol';
import {createGraphicalViewHarnessWithWindow, FakeGraphicalViewClient, flushPromises} from './graphicalViewTestHarness';

const OWNER = 'urn:samm:example.graphical:1.0.0#Aspect';
const TARGET_ID = 'gv-header-aaaaaaaaaaaaaaaa';
const createdUris: vscode.Uri[] = [];

suite('Graphical View editor reuse acceptance', () => {
    setup(async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    teardown(async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        for (const uri of createdUris.splice(0)) {
            try {
                await vscode.workspace.fs.delete(uri);
            } catch (_error) {
                // The test owns these unique temporary files; a missing file is already clean.
            }
        }
    });

    test('reuses the original visible source tab and does not create a second instance', async () => {
        const source = await createTurtleFile('visible-source', 'line 0\nline 1 target\n');
        const distracting = await createTurtleFile('visible-distracting', 'other\n');
        await vscode.window.showTextDocument(source, {viewColumn: vscode.ViewColumn.One, preview: false});
        const harness = await createAcceptedHarness(source);
        await vscode.window.showTextDocument(distracting, {viewColumn: vscode.ViewColumn.Two, preview: false});

        clickTarget(harness, source, 1, 7, 1, 13);
        await waitForNavigation(source, new vscode.Selection(1, 7, 1, 13));

        assert.equal(textTabs(source).length, 1);
        assert.equal(activeTextTabGroup(source)?.viewColumn, vscode.ViewColumn.One);
        assert.ok(vscode.window.activeTextEditor?.selection.isEqual(new vscode.Selection(1, 7, 1, 13)));
        harness.controller.dispose();
    });

    test('finds and reuses a source tab hidden behind another tab in its group', async () => {
        const source = await createTurtleFile('hidden-source', 'line 0\nline 1 target\n');
        const cover = await createTurtleFile('hidden-cover', 'cover\n');
        const distracting = await createTurtleFile('hidden-distracting', 'other\n');
        await vscode.window.showTextDocument(source, {viewColumn: vscode.ViewColumn.One, preview: false});
        const harness = await createAcceptedHarness(source);
        await vscode.window.showTextDocument(cover, {viewColumn: vscode.ViewColumn.One, preview: false});
        await vscode.window.showTextDocument(distracting, {viewColumn: vscode.ViewColumn.Two, preview: false});
        assert.equal(textTabs(source)[0]?.isActive, false);

        clickTarget(harness, source, 1, 7, 1, 13);
        await waitForNavigation(source, new vscode.Selection(1, 7, 1, 13));

        assert.equal(textTabs(source).length, 1);
        assert.equal(activeTextTabGroup(source)?.viewColumn, vscode.ViewColumn.One);
        assert.ok(vscode.window.activeTextEditor?.selection.isEqual(new vscode.Selection(1, 7, 1, 13)));
        harness.controller.dispose();
    });

    test('opens an unopened target once through the existing fallback placement', async () => {
        const source = await createTurtleFile('fallback-source', 'source\n');
        const target = await createTurtleFile('fallback-target', 'line 0\nline 1 target\n');
        const distracting = await createTurtleFile('fallback-distracting', 'other\n');
        await vscode.window.showTextDocument(source, {viewColumn: vscode.ViewColumn.One, preview: false});
        const harness = await createAcceptedHarness(source);
        await vscode.window.showTextDocument(distracting, {viewColumn: vscode.ViewColumn.Two, preview: false});
        assert.equal(textTabs(target).length, 0);

        clickTarget(harness, target, 1, 7, 1, 13);
        await waitForNavigation(target, new vscode.Selection(1, 7, 1, 13));

        assert.equal(textTabs(target).length, 1);
        assert.equal(activeTextTabGroup(target)?.viewColumn, vscode.ViewColumn.Two);
        assert.ok(vscode.window.activeTextEditor?.selection.isEqual(new vscode.Selection(1, 7, 1, 13)));
        harness.controller.dispose();
    });

    test('retained target resolving to notFound does not open or focus another tab', async () => {
        const source = await createTurtleFile('not-found-source', 'source\n');
        const distracting = await createTurtleFile('not-found-distracting', 'other\n');
        await vscode.window.showTextDocument(source, {viewColumn: vscode.ViewColumn.One, preview: false});
        const harness = await createAcceptedHarness(source);
        await vscode.window.showTextDocument(distracting, {viewColumn: vscode.ViewColumn.Two, preview: false});
        const activeBefore = vscode.window.activeTextEditor?.document.uri.toString();
        harness.client.resolveResult = {location: null, warning: 'notFound'};

        harness.panels.panels[0].emitMessage({type: 'navigate', version: 1, targetId: TARGET_ID});
        await flushPromises();

        assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), activeBefore);
        assert.equal(textTabs(source).length, 1);
        harness.controller.dispose();
    });
});

async function createAcceptedHarness(source: vscode.Uri) {
    const client = new FakeGraphicalViewClient();
    const harness = createGraphicalViewHarnessWithWindow(vscode.window, client);
    harness.workspace.available.add(source.toString());
    await harness.commands.execute('semantic-models.openGraphicalView');
    client.requests[0].deferred.resolve(renderResult(source));
    await flushPromises();
    return harness;
}

function clickTarget(
    harness: ReturnType<typeof createGraphicalViewHarnessWithWindow<typeof vscode.window>>,
    target: vscode.Uri,
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number,
): void {
    harness.client.resolveResult = {
        location: {
            uri: target.toString(),
            range: {
                start: {line: startLine, character: startCharacter},
                end: {line: endLine, character: endCharacter},
            },
        },
    };
    harness.panels.panels[0].emitMessage({type: 'navigate', version: 1, targetId: TARGET_ID});
}

function renderResult(source: vscode.Uri): GraphicalViewRenderResult {
    return {
        uri: source.toString(),
        svg: `<svg><g id="${TARGET_ID}"/></svg>`,
        targets: [{id: TARGET_ID, kind: 'elementHeader', elementUrn: OWNER}],
        warnings: [],
    };
}

function textTabs(uri: vscode.Uri): vscode.Tab[] {
    return vscode.window.tabGroups.all
        .flatMap(group => group.tabs)
        .filter(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString());
}

function activeTextTabGroup(uri: vscode.Uri): vscode.TabGroup | undefined {
    return vscode.window.tabGroups.all.find(group =>
        group.tabs.some(tab => tab.isActive && tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString()),
    );
}

async function createTurtleFile(name: string, contents: string): Promise<vscode.Uri> {
    const uri = vscode.Uri.file(`/tmp/esmf-task7-${process.pid}-${name}.ttl`);
    createdUris.push(uri);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(contents));
    return uri;
}

async function waitFor(predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (!predicate()) {
        if (Date.now() >= deadline) {
            assert.fail('Timed out waiting for the VS Code editor state.');
        }
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}

async function waitForNavigation(uri: vscode.Uri, selection: vscode.Selection): Promise<void> {
    await waitFor(() => {
        const editor = vscode.window.activeTextEditor;
        return editor?.document.uri.toString() === uri.toString() && editor.selection.isEqual(selection);
    });
}
