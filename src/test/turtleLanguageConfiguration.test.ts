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
import {PREDICATE_INDENT} from '../constants';
import {TURTLE_ON_ENTER_RULES} from '../turtleLanguageConfiguration';

/** Returns the action of the first rule that matches the text before the cursor, like VS Code does. */
function actionFor(lineBeforeCursor: string): vscode.EnterAction | undefined {
    return TURTLE_ON_ENTER_RULES.find(rule => rule.beforeText.test(lineBeforeCursor))?.action;
}

suite('Turtle on-enter rules', () => {
    test('indents the next line after a subject line that ends with a semicolon', () => {
        const action = actionFor(':Test a samm:Aspect ;');

        assert.equal(action?.indentAction, vscode.IndentAction.None);
        assert.equal(action?.appendText, PREDICATE_INDENT);
    });

    test('indents after a semicolon without a space before it', () => {
        assert.equal(actionFor(':Test a samm:Aspect;')?.appendText, PREDICATE_INDENT);
    });

    test('indents after a semicolon followed by trailing whitespace', () => {
        assert.equal(actionFor(':Test a samm:Aspect ;  ')?.appendText, PREDICATE_INDENT);
    });

    test('keeps the indentation of a predicate line that is already indented', () => {
        assert.equal(actionFor('   samm:preferredName "Test"@en ;'), undefined);
        assert.equal(actionFor('\tsamm:preferredName "Test"@en ;'), undefined);
    });

    test('does not indent after a line that does not end with a semicolon', () => {
        assert.equal(actionFor(':Test a samm:Aspect'), undefined);
        assert.equal(actionFor('@prefix samm: <urn:samm:org.eclipse.esmf.samm:meta-model:2.3.0#>'), undefined);
    });

    test('outdents after a statement that ends with a period', () => {
        const action = actionFor('   samm:events ( ) .');

        assert.equal(action?.indentAction, vscode.IndentAction.Outdent);
        assert.equal(action?.appendText, '\n');
    });
});
