# ESMF VS Code Plugin

## Table of Contents

- [Introduction](#introduction)
- [Build and contribute](#build-and-contribute)
- [Project Structure](#project-structure)
- [License](#license)

## Introduction

TODO

## Build and contribute

The top level elements of the Project Structure are all carried out as Maven multimodule projects.
Building the SDK requires Java 25.

To build the project, run the following command:
```bash
mvn clean install
```

We are always looking forward to your contributions. For more details on how to contribute just take
a look at the [contribution guidelines](CONTRIBUTING.md). Please create an issue first before
opening a pull request.

To quickly check if your contribution adheres to the project conventions, you can run `mvn
spotless:check` and `mvn checkstyle:check`; to automatically apply the project code style to your
changes, you can also use `mvn spotless:apply`. For more details, please see our
[conventions](CONVENTIONS.md.)

## Project Structure

TODO


## License

SPDX-License-Identifier: MPL-2.0

This program and the accompanying materials are made available under the terms of the
[Mozilla Public License, v. 2.0](LICENSE).

The [Notice file](NOTICE.md) details contained third party materials.
