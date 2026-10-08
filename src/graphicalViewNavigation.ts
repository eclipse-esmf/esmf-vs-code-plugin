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
import type {GraphicalViewClient} from './graphicalViewClient';
import type {GraphicalViewResolveTargetWarning, GraphicalViewTarget} from './graphicalViewProtocol';

export type GraphicalViewNavigationResolution =
    | Readonly<{kind: 'location'; uri: vscode.Uri; range: vscode.Range}>
    | Readonly<{kind: 'warning'; message: string}>;

const RESOLVE_WARNINGS: ReadonlySet<string> = new Set([
    'notFound',
    'ambiguous',
    'unsupportedUri',
    'temporarilyUnresolvable',
]);

export async function resolveGraphicalViewNavigation(
    client: GraphicalViewClient,
    sourceUri: string,
    target: Readonly<GraphicalViewTarget>,
    token: vscode.CancellationToken,
): Promise<GraphicalViewNavigationResolution> {
    const response = target.kind === 'elementHeader'
        ? await client.resolveElement({sourceUri, elementUrn: target.elementUrn}, token)
        : await client.resolveAttribute(
            {
                sourceUri,
                ownerUrn: target.ownerUrn,
                predicateUrn: target.predicateUrn,
                selection: target.selection,
                ...(target.language === undefined ? {} : {language: target.language}),
            },
            token,
        );
    return validateGraphicalViewResolveResult(response);
}

export function validateGraphicalViewResolveResult(value: unknown): GraphicalViewNavigationResolution {
    if (!isRecord(value) || !hasOnlyKeys(value, ['location', 'warning'])) {
        return invalidLocation();
    }

    const warning = value.warning;
    if (warning !== undefined && warning !== null && (typeof warning !== 'string' || !RESOLVE_WARNINGS.has(warning))) {
        return invalidLocation();
    }
    const location = value.location;
    if (location === undefined || location === null) {
        return typeof warning === 'string'
            ? {kind: 'warning', message: resolveWarningMessage(warning as GraphicalViewResolveTargetWarning)}
            : invalidLocation();
    }
    if (warning !== undefined && warning !== null) {
        return invalidLocation();
    }
    if (!isRecord(location) || !hasExactKeys(location, ['range', 'uri']) || typeof location.uri !== 'string') {
        return invalidLocation();
    }
    const range = location.range;
    if (!isRecord(range) || !hasExactKeys(range, ['end', 'start'])) {
        return invalidLocation();
    }
    const start = validatePosition(range.start);
    const end = validatePosition(range.end);
    if (!start || !end || start.isAfter(end)) {
        return invalidLocation();
    }

    try {
        const uri = vscode.Uri.parse(location.uri, true);
        if (uri.scheme !== 'file'
            || uri.authority !== ''
            || !uri.path.startsWith('/')
            || uri.query !== ''
            || uri.fragment !== ''
            || uri.fsPath.includes('\0')) {
            return {kind: 'warning', message: resolveWarningMessage('unsupportedUri')};
        }
        return {kind: 'location', uri, range: new vscode.Range(start, end)};
    } catch (_error) {
        return invalidLocation();
    }
}

function validatePosition(value: unknown): vscode.Position | undefined {
    if (!isRecord(value)
        || !hasExactKeys(value, ['character', 'line'])
        || !Number.isSafeInteger(value.line)
        || !Number.isSafeInteger(value.character)
        || (value.line as number) < 0
        || (value.character as number) < 0) {
        return undefined;
    }
    return new vscode.Position(value.line as number, value.character as number);
}

function invalidLocation(): GraphicalViewNavigationResolution {
    return {kind: 'warning', message: 'The language server returned an invalid graphical target location.'};
}

function resolveWarningMessage(warning: GraphicalViewResolveTargetWarning): string {
    switch (warning) {
        case 'notFound':
            return 'The graphical target no longer exists in the current model.';
        case 'ambiguous':
            return 'The graphical target is ambiguous in the current model.';
        case 'unsupportedUri':
            return 'The graphical target is not a local file and cannot be opened.';
        case 'temporarilyUnresolvable':
            return 'The graphical target is temporarily unavailable. Fix any model syntax errors and try again.';
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
    const allowed = new Set(allowedKeys);
    return Object.keys(value).every(key => allowed.has(key));
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
    const actualKeys = Object.keys(value).sort();
    return actualKeys.length === expectedKeys.length && actualKeys.every((key, index) => key === expectedKeys[index]);
}
