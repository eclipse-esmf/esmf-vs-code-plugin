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
