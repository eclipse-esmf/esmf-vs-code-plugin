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
import {PREDICATE_INDENT} from './constants';

/**
 * Rules applied when the user presses Enter in a Turtle file. The first matching rule wins.
 */
export const TURTLE_ON_ENTER_RULES: vscode.OnEnterRule[] = [
    {
        beforeText: /\.\s*$/,
        action: {
            indentAction: vscode.IndentAction.Outdent,
            appendText: '\n',
        },
    },
    {
        // A subject line (starts at column 0) that ends with ';' continues with its predicates.
        // Lines that are already indented keep their indentation (editor default).
        beforeText: /^\S.*;\s*$/,
        action: {
            indentAction: vscode.IndentAction.None,
            appendText: PREDICATE_INDENT,
        },
    },
];
