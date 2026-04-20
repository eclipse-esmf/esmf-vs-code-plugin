# Turtle LSP Extension

VS Code extension for the Turtle language server. The extension supports prefix `Go to Definition`, fast syntax feedback while typing, and server-driven heavy Aspect validation for SAMM-style Turtle models.

## Requirements

- Java must be available in `PATH`.
- The server project must be checked out next to this extension at `../lsp-server`.
- Build the Maven server JAR before launching the extension:

```bash
cd ../lsp-server
mvn package
```

The extension starts the server from `../lsp-server/target/lsp-server.jar`.

## Features

- Prefix `Go to Definition` inside Turtle files.
- Two-level validation:
  - Fast feedback on type from the regular Turtle parser diagnostics provided by the server.
  - Heavy Aspect validation from the server for model-level issues.
- Manual validation command:
  - `Validate Aspect Model Now`
- Standard diagnostics flow:
  - errors appear in the editor
  - errors appear in `Problems`

## Run The Server And Extension Together

1. Build the server in `../lsp-server` with `mvn package`.
2. In this extension project, install dependencies with `npm install`.
3. Compile the extension with `npm run compile`.
4. Press `F5` in VS Code to open an Extension Development Host.
5. Open a Turtle file such as [samples/valid.ttl](/Users/Evgenii_Filchenko/vs-code-project/extension/samples/valid.ttl) or your Aspect model file.

If the server JAR is missing, the extension shows an error and does not start the language client.

## Validation Behavior

Fast feedback on type:

- Driven by the server's regular Turtle parsing diagnostics.
- Intended for quick editor feedback while you type.

Heavy Aspect validation:

- Runs on the server, not in the extension.
- Uses standard LSP diagnostics so the result appears in the editor and in `Problems`.
- Always uses detailed server validation messaging when the server returns report text.
- Always shows visible progress for long-running validation.
- Runs automatically on save and can also be triggered manually.

When each validation runs:

- On type: fast syntax feedback only.
- On save: heavy Aspect validation for Turtle documents.
- Manual: `Validate Aspect Model Now` for the active Turtle document.

## Commands

- `Turtle LSP: Validate Aspect Model Now`
  - Sends a server request for the active Turtle document.

## UX During Long-Running Validation

- Manual validation shows a progress notification while the request is running.
- Save-triggered validation always uses a short status-bar progress indicator instead of repeated popups.
- After completion, the user gets a summary that includes the first detailed server report line when available.
- Automatic save validation keeps progress and completion feedback in the status bar.

## Verify Go To Definition

Use [samples/valid.ttl](/Users/Evgenii_Filchenko/vs-code-project/extension/samples/valid.ttl):

1. Open `samples/valid.ttl`.
2. Place the cursor on `foaf:Person`, `foaf:name`, or another prefixed name.
3. Run `Go to Definition`.
4. Confirm that VS Code jumps to the matching `@prefix` declaration.

Expected behavior:

- `foaf:*` resolves to `@prefix foaf: ...`.
- `ex:*` resolves to `@prefix ex: ...`.

## Verify Aspect Validation

Use an Aspect model file, for example:

```turtle
@prefix : <urn:samm:org.eclipse.esmf.test:1.0.0#> .
@prefix samm: <urn:samm:org.eclipse.esmf.samm:meta-model:2.2.0#> .

:InvalidSyntax a samm:Aspect;
   samm:preferredName "Test Aspect"@en
   samm:properties () ;
   samm:operations () .
```

Manual check:

1. Open the model file.
2. Run `Turtle LSP: Validate Aspect Model Now`.
3. Wait for the progress indicator to finish.
4. Confirm that diagnostics appear in the editor and in `Problems`.

On-save check:

1. Save the model file.
2. Confirm that the status bar shows validation progress.
3. Confirm that diagnostics are refreshed after completion.