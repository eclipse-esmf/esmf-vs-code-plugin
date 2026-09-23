# Semantic Models for VS Code

Semantic Models for VS Code is a Visual Studio Code extension for editing
RDF/Turtle documents, including [SAMM Aspect Models](https://eclipse-esmf.github.io/samm-specification/snapshot/index.html) of the [Eclipse Semantic Modeling Framework (ESMF)](https://eclipse-esmf.github.io/esmf-documentation/index.html).

For RDF/Turtle documents, it features syntax highlighting, document outline and
automatic syntax validation. For SAMM Aspect Models, the extension additionally
features *Go to Definition* for elements and semantic model validation.

## Configuration

- `semantic-models.languageServerSettings.activateEmbeddedLanguageServer` (boolean, default: `true`)
  - When enabled, the extension starts the SAMM language server process. When disabled, an external language server must be started manually.
- `semantic-models.languageServerSettings.automaticUpdateCheck` (boolean, default: `true`)
  - Automatically check for updates to the SAMM language server and notify when a new version is available.
- `semantic-models.languageServerSettings.sammCliPath` (string)
  - Path to the SAMM CLI executable or JAR file to use as the language server. Can be downloaded or selected using the 'Select SAMM CLI Executable' command.
- `semantic-models.languageServerSettings.serverPort` (number, default: `1846`)
  - TCP port used to connect to the SAMM language server.
- `semantic-models.languageServerSettings.additionalStartupOptions` (string, default: `""`)
  - Additional comma-separated command-line options (e.g. `-Dkey=value`, `-Dkey2=value2`) to pass when starting the language server.
- `semantic-models.modelResolution.githubRepositories` (array, default: `[]`)
  - Additional GitHub repositories to use for Aspect Model Resolution (e.g. `Go to Definition` and validation of models referencing Aspect Models hosted in other repositories). Each entry supports:
    - `repository` (string, required) - repository in the format `owner/repository`, e.g. `eclipse-esmf/esmf-sdk`.
    - `branch` (string, default: `main`) - branch to resolve Aspect Models from. Must not be set together with `tag`.
    - `tag` (string) - tag to resolve Aspect Models from. Must not be set together with `branch`.
    - `path` (string, default: `/`) - path inside the repository under which Aspect Models are located.
    - `token` (string) - GitHub token for authentication. If omitted, the repository is accessed anonymously.
  - Whenever this setting changes, the extension validates that each repository exists and is accessible, and shows an error notification (with a link to the settings) if a problem is found, e.g. a missing repository, invalid/expired token, or exceeded API rate limits.

Use the command `Semantic Models: Select SAMM CLI Executable` to choose either:
- one of the latest SAMM CLI GitHub releases, or
- a custom executable path from your local file system.

## Features

- Prefix `Go to Definition` inside Turtle files.
- Two-level validation:
  - Fast validation while typing from the regular Turtle parser diagnostics provided by the server (appear in the editor and `Problems`).
  - Full Aspect validation from the server for model-level issues (results shown in notifications and status bar).
- Manual validation command:
  - `Semantic Models: Validate Document Now`

## Graphical View

Use `Semantic Models: Open Graphical View` (`semantic-models.openGraphicalView`) from the Turtle editor-title button, the editor context menu, or the Command Palette to open a read-only SVG snapshot in a separate panel. One panel is reused per Turtle document.

The view renders on initial open, manual Refresh, and Save while the main Turtle document is visible. It includes unsaved text from the main document but uses the persisted versions of imported files. Typing, import saves, hidden-document saves, and revealing an existing panel do not trigger a render.

Element headers can navigate to definitions in local files. Eligible attribute rows whose owner is a named model element navigate as a whole row; language-qualified and wrapped rows retain their source mapping, and aggregated rows navigate to the start of the corresponding predicate. Rows with anonymous or otherwise non-deterministic owners remain inert. Navigation to remote URIs and arbitrary referenced values is not supported.

If rendering fails, the last successful diagram remains visible with an error or warning. Rendering is limited to 1,000 boxes and a 30-second request timeout. The graphical view is not an editor, does not update live while typing, and does not claim visual parity with the Aspect Model Editor.

Graphical View supports SVG only from the shipped/current trusted SAMM language server and generator contract. The extension strict-parses each SVG as XML but does not sanitize or filter its elements and attributes. Its restrictive webview CSP and extension-side message, sidecar, and local-file navigation validation remain enforced. External, substituted, incompatible, or compromised language servers are outside the supported security model; future Graphper or generator changes must preserve the tested style-free passive-output invariant.

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
- Manual: `Semantic Models: Validate Document Now` for the active Turtle document.

## Commands

- `Semantic Models: Validate Document Now`
  - Sends a server request for the active Turtle document.
- `Semantic Models: Select SAMM CLI Executable`
  - Opens a quick pick with the latest ten GitHub releases and a custom-path option.
- `Semantic Models: Restart Language Server Connection`
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
2. Run `Semantic Models: Validate Document Now`.
3. Wait for validation to complete.
4. Confirm that validation results are displayed in a notification.

On-save check:

1. Save the model file.
2. Confirm that the status bar shows validation progress.
3. Confirm that a summary message appears in the status bar after completion.
