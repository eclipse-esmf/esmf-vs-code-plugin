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

import type * as vscode from 'vscode';
import type {RequestClient} from './aspectValidation';
import {
    GRAPHICAL_VIEW_RENDER_REQUEST,
    GRAPHICAL_VIEW_RESOLVE_ATTRIBUTE_TARGET_REQUEST,
    GRAPHICAL_VIEW_RESOLVE_TARGET_REQUEST,
    GraphicalViewRenderParams,
    GraphicalViewRenderResult,
    GraphicalViewResolveAttributeTargetParams,
    GraphicalViewResolveAttributeTargetResult,
    GraphicalViewResolveTargetParams,
    GraphicalViewResolveTargetResult,
} from './graphicalViewProtocol';

export interface GraphicalViewClient {
    isAvailable(): boolean;
    onDidChangeAvailability(listener: (available: boolean) => void): vscode.Disposable;
    render(params: GraphicalViewRenderParams, token: vscode.CancellationToken): Thenable<GraphicalViewRenderResult>;
    resolveElement(
        params: GraphicalViewResolveTargetParams,
        token: vscode.CancellationToken,
    ): Thenable<GraphicalViewResolveTargetResult>;
    resolveAttribute(
        params: GraphicalViewResolveAttributeTargetParams,
        token: vscode.CancellationToken,
    ): Thenable<GraphicalViewResolveAttributeTargetResult>;
}

export interface GraphicalViewRequestTransport extends RequestClient {
    isAvailable(): boolean;
    onDidChangeAvailability(listener: (available: boolean) => void): vscode.Disposable;
}

export class LspGraphicalViewClient implements GraphicalViewClient {
    constructor(private readonly transport: GraphicalViewRequestTransport) {}

    isAvailable(): boolean {
        return this.transport.isAvailable();
    }

    onDidChangeAvailability(listener: (available: boolean) => void): vscode.Disposable {
        return this.transport.onDidChangeAvailability(listener);
    }

    render(params: GraphicalViewRenderParams, token: vscode.CancellationToken): Thenable<GraphicalViewRenderResult> {
        return this.transport.sendRequest<GraphicalViewRenderResult>(GRAPHICAL_VIEW_RENDER_REQUEST, params, token);
    }

    resolveElement(
        params: GraphicalViewResolveTargetParams,
        token: vscode.CancellationToken,
    ): Thenable<GraphicalViewResolveTargetResult> {
        return this.transport.sendRequest<GraphicalViewResolveTargetResult>(
            GRAPHICAL_VIEW_RESOLVE_TARGET_REQUEST,
            params,
            token,
        );
    }

    resolveAttribute(
        params: GraphicalViewResolveAttributeTargetParams,
        token: vscode.CancellationToken,
    ): Thenable<GraphicalViewResolveAttributeTargetResult> {
        return this.transport.sendRequest<GraphicalViewResolveAttributeTargetResult>(
            GRAPHICAL_VIEW_RESOLVE_ATTRIBUTE_TARGET_REQUEST,
            params,
            token,
        );
    }
}
