/*
 * Copyright (c) 2026 Robert Bosch Manufacturing Solutions GmbH
 * SPDX-License-Identifier: MPL-2.0
 */

import * as assert from 'node:assert/strict';
import {join} from 'node:path';
import * as vscode from 'vscode';
import {createGraphicalViewPanelOptions, createGraphicalViewShell} from '../graphicalViewPanel';

const HEADER_MARKER = 'gv-header-aaaaaaaaaaaaaaaa';
const GERMAN_MARKER = 'gv-attribute-bbbbbbbbbbbbbbbb';
const ENGLISH_MARKER = 'gv-attribute-eeeeeeeeeeeeeeee';

suite('GraphicalView real webview lifecycle', function () {
    this.timeout(30_000);

    test('securely renders and rehydrates the stable shell after real context recreation', async function (this: Mocha.Context) {
        this.timeout(30_000);
        const extensionUri = vscode.Uri.file(join(__dirname, '..', '..'));
        const panel = vscode.window.createWebviewPanel(
            'semantic-models.graphicalViewLifecycleTest',
            'Graphical View Lifecycle Test',
            vscode.ViewColumn.One,
            createGraphicalViewPanelOptions(extensionUri),
        );
        const messages: unknown[] = [];
        const subscription = panel.webview.onDidReceiveMessage(message => messages.push(message));
        const shell = instrumentShell(createGraphicalViewShell(panel.webview, extensionUri));
        const themeConfiguration = vscode.workspace.getConfiguration('workbench');
        const originalTheme = themeConfiguration.get<string>('colorTheme');

        try {
            panel.webview.html = shell;
            await waitFor(() => countMessages(messages, 'ready') >= 1, 'initial ready');
            assert.equal(await panel.webview.postMessage({type: 'render', version: 1, svg: graphperSvg(HEADER_MARKER)}), true);
            await waitFor(() => hasMessage(messages, 'rendered', 1), 'initial secure render');
            assert.equal(hasMessage(messages, 'renderError', 1), false);

            const initial = await probe(panel, messages, 'snapshot');
            assert.equal(initial.state.viewportInitialized, true);
            const expectedFit = Math.max(
                0.25,
                Math.min(4, Math.min((initial.viewport.clientWidth - 24) / 2200, (initial.viewport.clientHeight - 24) / 1600)),
            );
            assert.ok(Math.abs(initial.state.zoom - expectedFit) < 0.000_001);
            assertCenteredFreeAxes(initial);

            await panel.webview.postMessage({type: 'render', version: 101, svg: sizedSvg(10_000, 10_000)});
            await waitFor(() => hasMessage(messages, 'rendered', 101), 'oversized render');
            await probe(panel, messages, 'fit');
            const oversizedStart = await probe(panel, messages, 'snapshot');
            assert.equal(oversizedStart.state.zoom, 0.25);
            assert.ok(oversizedStart.viewport.maximumLeft > 0);
            assert.ok(oversizedStart.viewport.maximumTop > 0);
            assert.ok(oversizedStart.svg.left >= oversizedStart.viewport.left);
            assert.ok(oversizedStart.svg.top >= oversizedStart.viewport.top);
            const oversizedEnd = await probe(panel, messages, 'scrollEnd');
            assert.ok(oversizedEnd.svg.right <= oversizedEnd.viewport.right + 1);
            assert.ok(oversizedEnd.svg.bottom <= oversizedEnd.viewport.bottom + 1);

            await panel.webview.postMessage({type: 'render', version: 102, svg: sizedSvg(2200, 1600)});
            await waitFor(() => hasMessage(messages, 'rendered', 102), 'anchor fixture render');
            await probe(panel, messages, 'fit');
            const ordinary = await probe(panel, messages, 'ordinaryWheel');
            assert.equal(ordinary.prevented, false);
            assert.equal(ordinary.beforeZoom, ordinary.afterZoom);

            const wheel = await probe(panel, messages, 'modifierWheel');
            assert.equal(wheel.prevented, true);
            assert.ok(wheel.afterZoom > wheel.beforeZoom);
            assert.ok(
                Math.abs(wheel.beforePoint.x - wheel.afterPoint.x) * wheel.afterZoom < 0.5,
                `wheel x anchor drift: ${JSON.stringify(wheel)}`,
            );
            assert.ok(
                Math.abs(wheel.beforePoint.y - wheel.afterPoint.y) * wheel.afterZoom < 0.5,
                `wheel y anchor drift: ${JSON.stringify(wheel)}`,
            );

            const metaPinch = await probe(panel, messages, 'metaPinch');
            assert.equal(metaPinch.prevented, true);
            assert.ok(metaPinch.afterZoom < metaPinch.beforeZoom);
            const rapidWheel = await probe(panel, messages, 'rapidWheel');
            assert.equal(rapidWheel.prevented, true);
            assert.ok(rapidWheel.afterZoom > rapidWheel.beforeZoom);
            assert.ok(rapidWheel.afterZoom / rapidWheel.beforeZoom <= Math.exp(0.2) + 0.000_001);

            const button = await probe(panel, messages, 'zoomIn');
            assert.ok(button.afterZoom > button.beforeZoom);
            assert.ok(Math.abs(button.beforePoint.x - button.afterPoint.x) * button.afterZoom < 0.5);
            assert.ok(Math.abs(button.beforePoint.y - button.afterPoint.y) * button.afterZoom < 0.5);
            const reset = await probe(panel, messages, 'reset');
            assert.equal(reset.state.zoom, 1);

            const resizedFit = await probe(panel, messages, 'resizeAndFit');
            const resizedExpected = Math.max(
                0.25,
                Math.min(4, Math.min((resizedFit.viewport.clientWidth - 24) / 2200, (resizedFit.viewport.clientHeight - 24) / 1600)),
            );
            assert.ok(Math.abs(resizedFit.state.zoom - resizedExpected) < 0.000_001);
            assertCenteredFreeAxes(resizedFit);
            assert.equal(resizedFit.styles.overflow, 'auto');
            assert.notEqual(resizedFit.styles.buttonDisplay, 'none');
            assert.notEqual(resizedFit.styles.diagramDisplay, 'none');

            await panel.webview.postMessage({type: 'render', version: 103, svg: sizedSvg(200, 1600)});
            await waitFor(() => hasMessage(messages, 'rendered', 103), 'horizontal free-space fixture');
            await probe(panel, messages, 'fit');
            const horizontallyCentered = await probe(panel, messages, 'snapshot');
            assert.ok(horizontallyCentered.viewport.clientWidth - 24 - horizontallyCentered.svg.width > 0.5);
            assertCenteredFreeAxes(horizontallyCentered);

            await panel.webview.postMessage({type: 'render', version: 104, svg: sizedSvg(2200, 200)});
            await waitFor(() => hasMessage(messages, 'rendered', 104), 'vertical free-space fixture');
            await probe(panel, messages, 'fit');
            const verticallyCentered = await probe(panel, messages, 'snapshot');
            assert.ok(verticallyCentered.viewport.clientHeight - 24 - verticallyCentered.svg.height > 0.5);
            assertCenteredFreeAxes(verticallyCentered);

            for (const theme of ['Default Light Modern', 'Default Dark Modern', 'Default High Contrast']) {
                await themeConfiguration.update('colorTheme', theme, vscode.ConfigurationTarget.Global);
                const themed = await probe(panel, messages, 'snapshot');
                assert.notEqual(themed.styles.bodyColor, '');
                assert.notEqual(themed.styles.bodyBackground, 'rgba(0, 0, 0, 0)');
                assert.notEqual(themed.styles.buttonDisplay, 'none');
                assert.notEqual(themed.styles.diagramDisplay, 'none');
            }

            await probe(panel, messages, 'clearResize');
            await panel.webview.postMessage({type: 'render', version: 105, svg: graphperSvg(HEADER_MARKER)});
            await waitFor(() => hasMessage(messages, 'rendered', 105), 'restoration fixture');
            await probe(panel, messages, 'reset');
            const restorationState = (await probe(panel, messages, 'zoomIn')).state;

            const hiddenDocument = await vscode.workspace.openTextDocument({content: 'Hide graphical view', language: 'plaintext'});
            await vscode.window.showTextDocument(hiddenDocument, {viewColumn: vscode.ViewColumn.One, preview: false});
            await waitFor(() => !panel.visible, 'webview becoming hidden');
            const rendersBeforeReveal = countMessages(messages, 'rendered');

            panel.reveal(vscode.ViewColumn.One, false);
            await waitFor(() => countMessages(messages, 'ready') >= 2, 'recreated webview ready');
            assert.equal(countMessages(messages, 'rendered'), rendersBeforeReveal, 'reveal must not render by itself');
            assert.equal(panel.webview.html, shell, 'stable shell must not be reassigned per result');

            // The host cannot inspect webview state directly. Reload a fresh test-instrumented shell only after
            // proving that production reveal did not assign HTML or render; VS Code must retain getState() data.
            const readyBeforeInstrumentedReload = countMessages(messages, 'ready');
            panel.webview.html = instrumentShell(createGraphicalViewShell(panel.webview, extensionUri));
            await waitFor(() => countMessages(messages, 'ready') > readyBeforeInstrumentedReload, 'instrumented state reload');
            const rendersBeforeRedelivery = countMessages(messages, 'rendered');
            const snapshotsBeforeRedelivery = countMessages(messages, 'acceptanceAutoSnapshot');
            await panel.webview.postMessage({type: 'render', version: 105, svg: graphperSvg(HEADER_MARKER)});
            await waitFor(() => countMessages(messages, 'rendered') > rendersBeforeRedelivery, 'retained result rehydration');
            await waitFor(
                () => countMessages(messages, 'acceptanceAutoSnapshot') > snapshotsBeforeRedelivery,
                'rehydrated viewport snapshot',
            );
            const rehydrated = latestMessage(messages, 'acceptanceAutoSnapshot') as ViewportProbeResult;
            assert.equal(rehydrated.state.zoom, restorationState.zoom);
            assert.equal(rehydrated.state.scrollLeft, restorationState.scrollLeft);
            assert.equal(rehydrated.state.scrollTop, restorationState.scrollTop);
            assert.equal(rehydrated.state.viewportInitialized, true);
            await panel.webview.postMessage({
                type: 'render',
                version: 2,
                svg: multilingualSvg(GERMAN_MARKER, ENGLISH_MARKER),
            });
            await waitFor(() => hasMessage(messages, 'rendered', 2), 'multilingual replacement render');
            assert.equal(
                messages.some(message => isRecord(message) && message.type === 'renderError'),
                false,
            );

            await panel.webview.postMessage({
                type: 'render',
                version: 3,
                svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>&#1;</text></svg>',
            });
            await waitFor(() => hasMessage(messages, 'renderError', 3), 'XML-forbidden control rejection');
            await panel.webview.postMessage({type: 'render', version: 4, svg: '<html width="10" height="10"/>'});
            await waitFor(() => hasMessage(messages, 'renderError', 4), 'non-SVG root rejection');
            await panel.webview.postMessage({
                type: 'render',
                version: 5,
                svg: '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="10"/>',
            });
            await waitFor(() => hasMessage(messages, 'renderError', 5), 'invalid dimension rejection');
            await panel.webview.postMessage({type: 'render', version: 6, svg: ''});
            await waitFor(() => hasMessage(messages, 'renderError', 6), 'missing root rejection');
            await panel.webview.postMessage({
                type: 'render',
                version: 7,
                svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
            });
            await waitFor(() => hasMessage(messages, 'renderError', 7), 'multiple root rejection');
            await panel.webview.postMessage({type: 'render', version: 8, svg: '<svg width="10" height="10"/>'});
            await waitFor(() => hasMessage(messages, 'renderError', 8), 'wrong namespace rejection');
        } finally {
            subscription.dispose();
            panel.dispose();
            await themeConfiguration.update('colorTheme', originalTheme, vscode.ConfigurationTarget.Global);
        }
    });
});

function graphperSvg(marker: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" height="1600pt" width="2200pt" viewBox="0 0 2200 1600">
<g id="graph_root" class="graph" transform="scale(1 1) rotate(0)">
<g id="${marker}" class="node">
<polygon id="${marker}_polygon" points="10,10 2190,10 2190,1590 10,1590" fill="#ffffff" stroke="#000000" stroke-width="1" cx="0" cy="0" rx="0" ry="0"></polygon>
<text id="${marker}_text_0" x="1100" y="800" fill="#000000" font-family="Arial" font-size="12" text-anchor="middle">Aspect</text>
<title>Aspect</title>
</g>
</g>
</svg>`;
}

function multilingualSvg(germanMarker: string, englishMarker: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" height="1600pt" width="2200pt" viewBox="0 0 2200 1600">
<g id="graph_root" class="graph" transform="scale(1 1) rotate(0)">
<g id="${germanMarker}" class="node"><polygon points="10,10 2190,10 2190,700 10,700"></polygon><text x="20" y="300">description [de]: Beschreibung</text></g>
<g id="${englishMarker}" class="node"><polygon points="10,710 2190,710 2190,1590 10,1590"></polygon><text x="20" y="1000">description [en]: Description</text></g>
</g>
</svg>`;
}

function sizedSvg(width: number, height: number): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path d="M0 0 L${width} ${height}" stroke="#000000"/></svg>`;
}

function instrumentShell(shell: string): string {
    const scriptMatch = shell.match(/(<script nonce="([^"]+)" src="[^"]+"><\/script>)/);
    assert.ok(scriptMatch);
    const [, controllerScript, nonce] = scriptMatch;
    const bootstrap = `<script nonce="${nonce}">globalThis.__gvTestApi=acquireVsCodeApi();globalThis.acquireVsCodeApi=()=>globalThis.__gvTestApi;</script>`;
    const probeScript = `<script nonce="${nonce}">
const testApi=globalThis.__gvTestApi;
const afterFrame=callback=>{
  let completed=false;
  const complete=()=>{if(completed)return;completed=true;callback();};
  requestAnimationFrame(complete);
  setTimeout(complete,100);
};
const nextFrames=(count,callback)=>count<=0?callback():afterFrame(()=>nextFrames(count-1,callback));
const measure=()=>{
  const viewport=document.querySelector('#viewport');
  const svg=document.querySelector('#diagram svg');
  const button=document.querySelector('#zoom-in');
  const viewportBounds=viewport.getBoundingClientRect();
  const svgBounds=svg.getBoundingClientRect();
  const state=testApi.getState();
  return {
    state,
    viewport:{left:viewportBounds.left,top:viewportBounds.top,right:viewportBounds.right,bottom:viewportBounds.bottom,clientWidth:viewport.clientWidth,clientHeight:viewport.clientHeight,maximumLeft:viewport.scrollWidth-viewport.clientWidth,maximumTop:viewport.scrollHeight-viewport.clientHeight},
    svg:{left:svgBounds.left,top:svgBounds.top,right:svgBounds.right,bottom:svgBounds.bottom,width:svgBounds.width,height:svgBounds.height},
    styles:{overflow:getComputedStyle(viewport).overflow,buttonDisplay:getComputedStyle(button).display,diagramDisplay:getComputedStyle(svg).display,bodyColor:getComputedStyle(document.body).color,bodyBackground:getComputedStyle(document.body).backgroundColor}
  };
};
const center=()=>{const viewport=document.querySelector('#viewport');const bounds=viewport.getBoundingClientRect();return {x:bounds.left+viewport.clientWidth/2,y:bounds.top+viewport.clientHeight/2};};
const point=(position)=>{const snapshot=measure();return {x:(position.x-snapshot.svg.left)/snapshot.state.zoom,y:(position.y-snapshot.svg.top)/snapshot.state.zoom};};
addEventListener('message',event=>{
  const command=event.data;
  if(command&&command.type==='render'){
    nextFrames(3,()=>testApi.postMessage({type:'acceptanceAutoSnapshot',version:command.version,...measure()}));return;
  }
  if(!command||command.type!=='acceptanceProbe')return;
  const viewport=document.querySelector('#viewport');
  const finish=extra=>nextFrames(3,()=>testApi.postMessage({type:'acceptanceResult',id:command.id,...measure(),...extra}));
  if(command.action==='snapshot'){finish({});return;}
  if(command.action==='fit'){document.querySelector('#zoom-fit').click();finish({});return;}
  if(command.action==='scrollEnd'){
    viewport.scrollLeft=viewport.scrollWidth;viewport.scrollTop=viewport.scrollHeight;
    testApi.postMessage({type:'acceptanceResult',id:command.id,...measure()});return;
  }
  if(command.action==='ordinaryWheel'){
    const position=center();const beforeZoom=testApi.getState().zoom;
    const event=new WheelEvent('wheel',{deltaY:40,clientX:position.x,clientY:position.y,bubbles:true,cancelable:true});
    const dispatched=viewport.dispatchEvent(event);finish({prevented:!dispatched,beforeZoom,afterZoom:testApi.getState().zoom});return;
  }
  if(command.action==='modifierWheel'){
    const position={x:viewport.getBoundingClientRect().left+viewport.clientWidth*.37,y:viewport.getBoundingClientRect().top+viewport.clientHeight*.43};
    const beforePoint=point(position);const beforeZoom=testApi.getState().zoom;
    const event=new WheelEvent('wheel',{deltaY:-60,ctrlKey:true,clientX:position.x,clientY:position.y,bubbles:true,cancelable:true});
    const dispatched=viewport.dispatchEvent(event);
    nextFrames(3,()=>testApi.postMessage({type:'acceptanceResult',id:command.id,...measure(),prevented:!dispatched,beforeZoom,afterZoom:testApi.getState().zoom,beforePoint,afterPoint:point(position)}));return;
  }
  if(command.action==='metaPinch'){
    const position=center();const beforeZoom=testApi.getState().zoom;
    const event=new WheelEvent('wheel',{deltaY:40,metaKey:true,clientX:position.x,clientY:position.y,bubbles:true,cancelable:true});
    const dispatched=viewport.dispatchEvent(event);
    nextFrames(3,()=>testApi.postMessage({type:'acceptanceResult',id:command.id,...measure(),prevented:!dispatched,beforeZoom,afterZoom:testApi.getState().zoom}));return;
  }
  if(command.action==='rapidWheel'){
    const position=center();const beforeZoom=testApi.getState().zoom;let prevented=true;
    for(let index=0;index<5;index++){
      const event=new WheelEvent('wheel',{deltaY:-40,ctrlKey:true,clientX:position.x,clientY:position.y,bubbles:true,cancelable:true});
      prevented=prevented&&!viewport.dispatchEvent(event);
    }
    nextFrames(3,()=>testApi.postMessage({type:'acceptanceResult',id:command.id,...measure(),prevented,beforeZoom,afterZoom:testApi.getState().zoom}));return;
  }
  if(command.action==='zoomIn'){
    const position=center();const beforePoint=point(position);const beforeZoom=testApi.getState().zoom;
    document.querySelector('#zoom-in').click();
    nextFrames(3,()=>testApi.postMessage({type:'acceptanceResult',id:command.id,...measure(),beforeZoom,afterZoom:testApi.getState().zoom,beforePoint,afterPoint:point(position)}));return;
  }
  if(command.action==='reset'){document.querySelector('#zoom-reset').click();finish({});return;}
  if(command.action==='clearResize'){viewport.style.flex='';viewport.style.width='';viewport.style.height='';finish({});return;}
  if(command.action==='resizeAndFit'){viewport.style.flex='none';viewport.style.width='640px';viewport.style.height='420px';document.querySelector('#zoom-fit').click();finish({});}
});
</script>`;
    return shell.replace(controllerScript, `${bootstrap}${controllerScript}${probeScript}`);
}

let probeId = 0;

async function probe(panel: vscode.WebviewPanel, messages: readonly unknown[], action: string): Promise<ViewportProbeResult> {
    const id = ++probeId;
    const attempts = ['snapshot', 'fit', 'clearResize'].includes(action) ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
        assert.equal(await panel.webview.postMessage({type: 'acceptanceProbe', id, action}), true);
        try {
            await waitFor(
                () => messages.some(message => isRecord(message) && message.type === 'acceptanceResult' && message.id === id),
                `viewport probe ${action}`,
                5_000,
            );
            return messages.find(
                (message): message is ViewportProbeResult => isRecord(message) && message.type === 'acceptanceResult' && message.id === id,
            ) as ViewportProbeResult;
        } catch (error) {
            if (attempt === attempts - 1) {
                throw error;
            }
        }
    }
    throw new Error(`Viewport probe ${action} did not complete.`);
}

function assertCenteredFreeAxes(result: ViewportProbeResult): void {
    const horizontalFreeSpace = result.viewport.clientWidth - 24 - result.svg.width;
    if (horizontalFreeSpace > 0.5) {
        assert.ok(Math.abs(result.svg.left - (result.viewport.left + 12 + horizontalFreeSpace / 2)) < 1);
    }
    const verticalFreeSpace = result.viewport.clientHeight - 24 - result.svg.height;
    if (verticalFreeSpace > 0.5) {
        assert.ok(Math.abs(result.svg.top - (result.viewport.top + 12 + verticalFreeSpace / 2)) < 1);
    }
}

interface ViewportProbeResult {
    type: 'acceptanceResult';
    id: number;
    state: {zoom: number; scrollLeft: number; scrollTop: number; viewportInitialized: boolean};
    viewport: {
        left: number;
        top: number;
        right: number;
        bottom: number;
        clientWidth: number;
        clientHeight: number;
        maximumLeft: number;
        maximumTop: number;
    };
    svg: {left: number; top: number; right: number; bottom: number; width: number; height: number};
    styles: {overflow: string; buttonDisplay: string; diagramDisplay: string; bodyColor: string; bodyBackground: string};
    prevented: boolean;
    beforeZoom: number;
    afterZoom: number;
    beforePoint: {x: number; y: number};
    afterPoint: {x: number; y: number};
}

async function waitFor(probe: () => boolean, description: string, timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (probe()) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for ${description}`);
}

function countMessages(messages: readonly unknown[], type: string): number {
    return messages.filter(message => isRecord(message) && message.type === type).length;
}

function hasMessage(messages: readonly unknown[], type: string, version: number): boolean {
    return messages.some(message => isRecord(message) && message.type === type && message.version === version);
}

function latestMessage(messages: readonly unknown[], type: string): unknown {
    return [...messages].reverse().find(message => isRecord(message) && message.type === type);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
