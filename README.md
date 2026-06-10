# esmf-vs-code-plugin

VS Code extension for the ESMF SDK Turtle language server. The extension supports prefix Go to Definition, fast syntax feedback while typing, and server-driven heavy Aspect validation for SAMM-style Turtle models.

## Project Structure

This repository contains the VS Code extension source code. For implementation details and architecture, see the [extension documentation](extension/README.md).

```
extension/          - VS Code extension source code and build outputs
  src/              - TypeScript source files
  samples/          - Example Turtle and SAMM Aspect Model files
  media/            - Walkthrough and logo images
  package.json      - Extension manifest and dependencies
  README.md         - Extension user and feature documentation
```

## Getting Started

### Prerequisites

- Node.js and npm
- VS Code 1.110.0 or later

### Development Setup

1. Clone and navigate to the extension folder:
   ```bash
   cd extension
   npm install
   ```

2. Build the extension:
   ```bash
   npm run build
   ```

3. Run or debug the extension:
   - Press `F5` in VS Code to launch the Extension Development Host with the extension loaded.
   - Open a `.ttl` file (e.g., `extension/samples/valid.ttl`) to activate the extension.

### Available Commands

- `npm run build` - Compile TypeScript
- `npm run watch` - Watch and recompile on file changes
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix linting issues
- `npm run prettier` - Format code with Prettier
- `npm run test` - Run tests
- `npm run test:coverage` - Run tests with coverage report

## Features

- **Prefix Go to Definition** - Jump to prefix definitions in Turtle files.
- **Fast Validation** - Real-time syntax feedback via the language server.
- **Aspect Validation** - Heavy model-level validation for SAMM Aspect models (on save and on-demand).
- **Interactive Setup** - Download or select SAMM-CLI executable via the command palette.
- **Configuration** - Customize language server settings (port, trace level, auto-update).

See [extension/README.md](extension/README.md) for complete feature documentation and usage instructions.

## Contributing

We welcome contributions! Please see [extension/CONTRIBUTING.md](extension/CONTRIBUTING.md) for:
- Contribution guidelines
- Branch and PR naming conventions
- Commit message standards
- License and copyright header requirements
- Code conventions and style guides

All contributions must comply with the Eclipse Contributor Agreement (ECA) and Eclipse IP Policy.

## License

This project is licensed under the Mozilla Public License v. 2.0. See LICENSE file for details.
