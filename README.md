# Semantic Models for VS Code

Semantic Models for VS Code is a Visual Studio Code extension for editing
RDF/Turtle documents, including [SAMM Aspect Models](https://eclipse-esmf.github.io/samm-specification/snapshot/index.html) of the [Eclipse Semantic Modeling Framework (ESMF)](https://eclipse-esmf.github.io/esmf-documentation/index.html).

For RDF/Turtle documents, it features syntax highlighting, document outline and
automatic syntax validation. For SAMM Aspect Models, the extension additionally
features *Go to Definition* for elements and semantic model validation.

For installation, prerequisites, and a sample walkthrough, see the [user guide](https://eclipse-esmf.github.io/vs-code-plugin/introduction.html).

## Configuration

- `semantic-models.languageServerSettings.activateEmbeddedLanguageServer` (boolean, default: `true`)
  - When enabled, the extension starts the SAMM language server process. When disabled, an external language server must be started manually.
- `semantic-models.languageServerSettings.automaticUpdateCheck` (boolean, default: `true`)
  - Automatically check for updates to the SAMM language server and notify when a new version is available.
- `semantic-models.languageServerSettings.sammCliPath` (string)
  - Path to the SAMM CLI executable or JAR file to use as the language server. Can be downloaded or selected using the 'Select SAMM CLI Executable' command.
- `semantic-models.languageServerSettings.serverPort` (number, default: `1846`)
  - TCP port used to connect to the SAMM language server.
- `semantic-models.languageServerSettings.environmentVariables` (object, default: `{}`)
  - A map of environment variable names to string values for the embedded language server (native executable or JAR). These values override inherited environment variables; other inherited variables are preserved. Externally managed servers are unaffected.
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

- `Go to Definition` of referenced elements within the same file, current workspace and also for SAMM elements.
- Two-level validation:
  - Fast validation while typing from the regular Turtle parser.
  - Full Aspect Model validation for model-level issues.
- Resolve Aspect Models from a GitHub repository:
  - Configure GitHub repositories that contain Aspect Models in extension settings.
  - Reference elements of these Aspect Models. Features like validation and `Go to Definition` automatically fetch the model from GitHub.
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
4. Open any RDF/Turtle.

If the server cannot be downloaded or started, the extension shows an error and writes a detailed message in the Semantic Models output channel.

## Validation Behavior

Fast feedback while typing:

- Issues are shown immediately in the editor and Problems view.
- Intended for quick feedback while you type.

Full Aspect validation:

- Runs on the server, not in the extension.
- Results appear in the editor and `Problems` view.
- Always uses detailed server validation messaging when the server returns report text.
- Runs automatically after a 4 second delay and when saving.

When each validation runs:

- While typing: Turtle syntax feedback.
- After a pause and on save: full Aspect Model validation.
- Manual: `Semantic Models: Validate Document Now` for the active Turtle document.

## Commands

- `Semantic Models: Validate Document Now`
  - Sends a server request for the active Turtle document.
- `Semantic Models: Select SAMM CLI Executable`
  - Opens a quick pick with the latest ten GitHub releases and a custom-path option.
- `Semantic Models: Restart Language Server Connection`
  - Restarts the language server and reconnects the client.
