// Copyright (c) 2026 Robert Bosch Manufacturing Solutions GmbH
//
// See the AUTHORS file(s) distributed with this work for additional
// information regarding authorship.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https:gmozilla.org/MPL/2.0/.
//
// SPDX-License-Identifier: MPL-2.0

import * as assert from 'assert';
import * as vscode from 'vscode';
import {AspectValidationController, VALIDATE_DOCUMENT_REQUEST} from '../aspectValidation';
import {createValidationControllerHarness, createValidationDocument} from './validationTestHarness';

describe('AspectValidationController', () => {
    test('sends manual validation request with notification progress and warning summary', async () => {
        const harness = createValidationControllerHarness({
            response: {valid: false, violations: [{code: 'E001'}], report: 'First detail line'},
        });

        await harness.controller.validateDocument(createValidationDocument('/tmp/Aspect.ttl'), 'manual');

        assert.deepStrictEqual(harness.sentRequests, [
            {
                method: VALIDATE_DOCUMENT_REQUEST,
                params: {uri: 'file:///tmp/Aspect.ttl', reason: 'manual'},
            },
        ]);
        assert.deepStrictEqual(harness.window.progressTitles, ['Aspect model validation']);
        assert.deepStrictEqual(harness.window.statusMessages, []);
        assert.deepStrictEqual(harness.window.warningMessages, ['Aspect validation found 1 issue. First detail line']);
    });

    test('register wires save validation through the workspace listener and status bar', async () => {
        const harness = createValidationControllerHarness({
            response: {valid: true, report: 'All checks completed successfully.'},
        });

        const context = {subscriptions: [] as vscode.Disposable[]} as unknown as vscode.ExtensionContext;
        await withStubbedRegisterCommand(() => {
            harness.controller.register(context);
        });

        await harness.workspace.fireSave(createValidationDocument('/tmp/Aspect.ttl'));

        assert.deepStrictEqual(harness.sentRequests, [
            {
                method: VALIDATE_DOCUMENT_REQUEST,
                params: {uri: 'file:///tmp/Aspect.ttl', reason: 'save'},
            },
        ]);
        assert.deepStrictEqual(harness.window.progressTitles, []);
        assert.deepStrictEqual(harness.window.statusMessages, [
            'Aspect model validation in progress...',
            'Aspect validation completed without issues. All checks completed successfully.',
        ]);
    });

    test('shows an info summary for successful manual validation', async () => {
        const harness = createValidationControllerHarness({
            response: {valid: true, report: 'Everything passed.'},
        });

        await harness.controller.validateDocument(createValidationDocument('/tmp/Aspect.ttl'), 'manual');

        assert.deepStrictEqual(harness.window.infoMessages, ['Aspect validation completed without issues. Everything passed.']);
        assert.deepStrictEqual(harness.window.warningMessages, []);
        assert.deepStrictEqual(harness.window.errorMessages, []);
    });

    test('shows an error message for server-side validation errors during manual runs', async () => {
        const harness = createValidationControllerHarness({
            response: {error: {message: 'Validator crashed'}},
        });

        await harness.controller.validateDocument(createValidationDocument('/tmp/Aspect.ttl'), 'manual');

        assert.deepStrictEqual(harness.window.errorMessages, ['Aspect validation failed: Validator crashed']);
        assert.deepStrictEqual(harness.window.infoMessages, []);
        assert.deepStrictEqual(harness.window.warningMessages, []);
    });

    test('reports failed save validations via the status bar instead of dialogs', async () => {
        const harness = createValidationControllerHarness({
            error: new Error('Method not found'),
        });

        await harness.controller.validateDocument(createValidationDocument('/tmp/Aspect.ttl'), 'save');

        assert.deepStrictEqual(harness.window.statusMessages, [
            'Aspect model validation in progress...',
            'Aspect validation request is not supported by the current server build.',
        ]);
        assert.deepStrictEqual(harness.window.errorMessages, []);
    });

    test('warns instead of sending a manual request when the active document is not Turtle', async () => {
        const harness = createValidationControllerHarness();

        await harness.controller.validateDocument(
            {
                languageId: 'plaintext',
                uri: vscode.Uri.file('/tmp/readme.txt'),
            },
            'manual',
        );

        assert.deepStrictEqual(harness.sentRequests, []);
        assert.deepStrictEqual(harness.window.warningMessages, ['Open a Turtle file before running aspect validation.']);
    });
});

async function withStubbedRegisterCommand(run: () => void | Promise<void>): Promise<void> {
    const originalRegisterCommand = vscode.commands.registerCommand;

    Object.assign(vscode.commands, {
        registerCommand: () => new vscode.Disposable(() => undefined),
    });

    try {
        await run();
    } finally {
        Object.assign(vscode.commands, {
            registerCommand: originalRegisterCommand,
        });
    }
}
