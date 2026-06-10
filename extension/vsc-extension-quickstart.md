# RDF/Turtle and SAMM Aspect Models VS Code Extension

## Project Structure

This folder contains the VS Code extension for the ESMF SDK Turtle language server.

* `package.json` - Extension manifest declaring commands, language support, settings, and walkthrough.
* `src/extension.ts` - Main extension entry point; handles activation, configuration, and language server lifecycle.
* `src/languageServer.ts` - Spawns and manages the SAMM-CLI language server process.
* `src/languageClient.ts` - Connects the VS Code language client to the server.
* `src/aspectValidation.ts` - Handles aspect model validation workflows (manual and on-save).
* `src/sammCliDownloader.ts` - Downloads and manages SAMM-CLI releases from GitHub.
* `src/settings.ts` - Reads and manages extension configuration.
* `samples/` - Example Turtle and Aspect model files for testing.

## Getting Started

1. Install dependencies: `npm install` (in `extension/` folder)
2. Build the extension: `npm run build`
3. Press `F5` to open an Extension Development Host with the extension loaded.
4. Open a `.ttl` file (e.g., `samples/valid.ttl`) to activate the extension.

See [README.md](README.md) for full feature documentation and usage instructions.
