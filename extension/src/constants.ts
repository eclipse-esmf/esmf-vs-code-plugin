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

/** JVM options passed to the SAMM-CLI when it is launched from a JAR. */
export const JAVA_OPTIONS = [
    '--enable-native-access=ALL-UNNAMED',
    '--sun-misc-unsafe-memory-access=allow',
    '-Dpolyglotimpl.DisableMultiReleaseCheck=true',
];

/** GitHub repository hosting the SAMM-CLI releases. */
export const GITHUB_RELEASE_REPOSITORY = 'eclipse-esmf/esmf-sdk';
