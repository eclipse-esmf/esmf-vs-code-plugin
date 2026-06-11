package com.example.turtlelsp.lsp.text;

import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;

import org.eclipse.lsp4j.Diagnostic;
import org.eclipse.lsp4j.services.LanguageClient;
import org.junit.jupiter.api.Test;

class TextDocumentClientNotifierTest {
    @Test
    void publishCombinedDiagnosticsUsesStoredDiagnostics() {
        DocumentDiagnosticsService diagnosticsService = mock(DocumentDiagnosticsService.class);
        LanguageClient client = mock(LanguageClient.class);
        TextDocumentClientNotifier notifier = new TextDocumentClientNotifier(diagnosticsService);
        List<Diagnostic> diagnostics = List.of(new Diagnostic());
        when(diagnosticsService.getCombined("file:///test.ttl")).thenReturn(diagnostics);
        notifier.connect(client);

        notifier.publishCombinedDiagnostics("file:///test.ttl");

        verify(diagnosticsService).getCombined("file:///test.ttl");
        verify(client).publishDiagnostics(argThat(params ->
            "file:///test.ttl".equals(params.getUri()) && params.getDiagnostics().equals(diagnostics)
        ));
    }

    @Test
    void publishEmptyDiagnosticsSendsEmptyList() {
        LanguageClient client = mock(LanguageClient.class);
        TextDocumentClientNotifier notifier = new TextDocumentClientNotifier(mock(DocumentDiagnosticsService.class));
        notifier.connect(client);

        notifier.publishEmptyDiagnostics("file:///test.ttl");

        verify(client).publishDiagnostics(argThat(params ->
            "file:///test.ttl".equals(params.getUri()) && params.getDiagnostics().isEmpty()
        ));
    }

    @Test
    void publishMethodsDoNothingWithoutClient() {
        DocumentDiagnosticsService diagnosticsService = mock(DocumentDiagnosticsService.class);
        TextDocumentClientNotifier notifier = new TextDocumentClientNotifier(diagnosticsService);

        notifier.publishCombinedDiagnostics("file:///test.ttl");
        notifier.publishEmptyDiagnostics("file:///test.ttl");

        verify(diagnosticsService, never()).getCombined("file:///test.ttl");
    }
}
