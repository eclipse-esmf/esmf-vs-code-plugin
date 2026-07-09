# Semantic Models for VS Code

Semantic Models for VS Code is a Visual Studio Code extension for editing
RDF/Turtle documents, including SAMM Aspect Models.

For RDF/Turtle documents, it features syntax highlighting, document outline and
automatic syntax validation. For SAMM Aspect Models, the extension additionally
features *Go to Definition* for elements and semantic model validation.

## Configuration

- `turtle.languageServerSettings.activateEmbeddedLanguageServer` (boolean, default: `true`)
  - When enabled, the extension starts the SAMM language server process. When disabled, an external language server must be started manually.
- `turtle.languageServerSettings.automaticUpdateCheck` (boolean, default: `true`)
  - Automatically check for updates to the SAMM language server and notify when a new version is available.
- `turtle.languageServerSettings.sammCliPath` (string)
  - Path to the SAMM CLI executable or JAR file to use as the language server. Can be downloaded or selected using the 'Select SAMM CLI Executable' command.
- `turtle.languageServerSettings.serverPort` (number, default: `1846`)
  - TCP port used to connect to the SAMM language server.
- `turtle.languageServerSettings.traceLevel` (string, default: `off`)
  - Controls the verbosity of Language Server Protocol (LSP) tracing. Options: `off`, `messages`, `verbose`.

Use the command `Turtle: Select SAMM CLI Executable` to choose either:
- one of the latest SAMM CLI GitHub releases, or
- a custom executable path from your local file system.

## Features

- Prefix `Go to Definition` inside Turtle files.
- Two-level validation:
  - Fast validation while typing from the regular Turtle parser diagnostics provided by the server (appear in the editor and `Problems`).
  - Full Aspect validation from the server for model-level issues (results shown in notifications and status bar).
- Manual validation command:
  - `Turtle: Validate Document Now`

## Running the Server and Extension Together

1. In this extension project, install the dependencies using `npm install`.
2. Build the extension with `npm run build`.
3. Press `F5` in VS Code to open an Extension Development Host.
4. Open an RDF/Turtle file such as [samples/valid.ttl](samples/valid.ttl) or your Aspect model file.

If the server cannot be downloaded or started, the extension shows an error and writes a detailed message in the Turtle LSP output channel.

## Validation Behavior

Fast feedback while typing:

- Driven by the server's regular Turtle parsing diagnostics.
- Results appear in the editor and `Problems` view.
- Intended for quick editor feedback while you type.

Full Aspect validation:

- Runs on the server, not in the extension.
- Results are displayed in notification messages (for manual validation) or status bar (for save-triggered validation).
- Always uses detailed server validation messaging when the server returns report text.
- Always shows visible progress for long-running validation.
- Runs automatically when saving and can also be triggered manually.

When each validation runs:

- On type: fast syntax feedback only.
- On save: heavy Aspect validation for Turtle documents.
- Manual: `Turtle: Validate Document Now` for the active Turtle document.

## Commands

- `Turtle: Validate Document Now`
  - Sends a server request for the active Turtle document.
- `Turtle: Select SAMM CLI Executable`
  - Opens a quick pick with the latest ten GitHub releases and a custom-path option.
- `Turtle: Restart Language Server Connection`
  - Restarts the language server and reconnects the client.

## UX During Long-Running Validation

- Manual validation shows a progress notification while the request is running.
- Save-triggered validation always uses a short status-bar progress indicator
  instead of repeated pop-up notifications.
- After completion, the user gets a summary message with validation results.
- Automatic save validation keeps progress and completion status in the status bar.

## Verify Go To Definition

Use [samples/valid.ttl](samples/valid.ttl):

1. Open `samples/valid.ttl`.
2. Place the cursor on `foaf:Person`, `foaf:name`, or another prefixed name.
3. Run `Go to Definition`.
4. Confirm that VS Code jumps to the matching `@prefix` declaration.

Expected behavior:

- `foaf:*` resolves to `@prefix foaf: ...`.
- `ex:*` resolves to `@prefix ex: ...`.

## Verify Aspect Validation

Use [samples/org.eclipse.esmf.test/1.0.0/Aspect.ttl](samples/org.eclipse.esmf.test/1.0.0/Aspect.ttl) or [samples/invalid.ttl](samples/invalid.ttl).

Manual check:

1. Open an Aspect model file.
2. Run `Turtle: Validate document now`.
3. Wait for validation to complete.
4. Confirm that validation results are displayed in a notification.

On-save check:

1. Save the model file.
2. Confirm that the status bar shows validation progress.
3. Confirm that a summary message appears in the status bar after completion.
