package com.example.turtlelsp.lsp.text;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.file.Path;
import java.util.function.BiConsumer;

import com.example.turtlelsp.aspect.model.AspectValidationResult;
import com.example.turtlelsp.aspect.service.AspectValidationCoordinator;
import org.junit.jupiter.api.Test;

class AspectDiagnosticsWorkflowTest {
    @Test
    void onDocumentChangedCancelsValidationAndClearsAspectDiagnostics() {
        AspectValidationCoordinator coordinator = mock(AspectValidationCoordinator.class);
        DocumentDiagnosticsService diagnosticsService = mock(DocumentDiagnosticsService.class);
        TextDocumentClientNotifier notifier = mock(TextDocumentClientNotifier.class);
        AspectDiagnosticsWorkflow workflow = new AspectDiagnosticsWorkflow(coordinator, diagnosticsService, notifier);

        workflow.onDocumentChanged("file:///test.ttl");

        verify(coordinator).cancel("file:///test.ttl");
        verify(diagnosticsService).clearAspect("file:///test.ttl");
    }

    @Test
    void onDocumentClosedCancelsValidationAndClearsAllDiagnostics() {
        AspectValidationCoordinator coordinator = mock(AspectValidationCoordinator.class);
        DocumentDiagnosticsService diagnosticsService = mock(DocumentDiagnosticsService.class);
        TextDocumentClientNotifier notifier = mock(TextDocumentClientNotifier.class);
        AspectDiagnosticsWorkflow workflow = new AspectDiagnosticsWorkflow(coordinator, diagnosticsService, notifier);

        workflow.onDocumentClosed("file:///test.ttl");

        verify(coordinator).cancel("file:///test.ttl");
        verify(diagnosticsService).clearAll("file:///test.ttl");
    }

    @Test
    void onDocumentSavedForNonFileUriClearsAspectDiagnosticsAndPublishesCombined() {
        AspectValidationCoordinator coordinator = mock(AspectValidationCoordinator.class);
        DocumentDiagnosticsService diagnosticsService = mock(DocumentDiagnosticsService.class);
        TextDocumentClientNotifier notifier = mock(TextDocumentClientNotifier.class);
        AspectDiagnosticsWorkflow workflow = new AspectDiagnosticsWorkflow(coordinator, diagnosticsService, notifier);

        workflow.onDocumentSaved("untitled:Aspect.ttl");

        verify(diagnosticsService).clearAspect("untitled:Aspect.ttl");
        verify(notifier).publishCombinedDiagnostics("untitled:Aspect.ttl");
        verify(coordinator, never()).submit(any(), any(), any(Long.class), any());
    }

    @Test
    void onDocumentSavedForFileUriSubmitsValidation() {
        AspectValidationCoordinator coordinator = mock(AspectValidationCoordinator.class);
        DocumentDiagnosticsService diagnosticsService = mock(DocumentDiagnosticsService.class);
        TextDocumentClientNotifier notifier = mock(TextDocumentClientNotifier.class);
        AspectDiagnosticsWorkflow workflow = new AspectDiagnosticsWorkflow(coordinator, diagnosticsService, notifier);
        String uri = Path.of("pom.xml").toAbsolutePath().toUri().toString();
        when(coordinator.nextGeneration(uri)).thenReturn(7L);

        workflow.onDocumentSaved(uri);

        verify(coordinator).nextGeneration(uri);
        verify(coordinator).submit(eq(uri), any(Path.class), eq(7L), any());
    }

    @Test
    void onDocumentSavedUpdatesDiagnosticsAndPublishesWhenResultIsCurrent() {
        AspectValidationCoordinator coordinator = mock(AspectValidationCoordinator.class);
        DocumentDiagnosticsService diagnosticsService = mock(DocumentDiagnosticsService.class);
        TextDocumentClientNotifier notifier = mock(TextDocumentClientNotifier.class);
        AspectDiagnosticsWorkflow workflow = new AspectDiagnosticsWorkflow(coordinator, diagnosticsService, notifier);
        String uri = Path.of("pom.xml").toAbsolutePath().toUri().toString();
        AspectValidationResult result = mock(AspectValidationResult.class);
        when(coordinator.nextGeneration(uri)).thenReturn(3L);
        when(coordinator.currentGeneration(uri)).thenReturn(3L);
        doAnswer(invocation -> {
            BiConsumer<Long, AspectValidationResult> callback = invocation.getArgument(3);
            callback.accept(3L, result);
            return null;
        }).when(coordinator).submit(eq(uri), any(Path.class), eq(3L), any());

        workflow.onDocumentSaved(uri);

        verify(diagnosticsService).updateAspect(uri, result);
        verify(notifier).publishCombinedDiagnostics(uri);
    }

    @Test
    void onDocumentSavedIgnoresStaleResult() {
        AspectValidationCoordinator coordinator = mock(AspectValidationCoordinator.class);
        DocumentDiagnosticsService diagnosticsService = mock(DocumentDiagnosticsService.class);
        TextDocumentClientNotifier notifier = mock(TextDocumentClientNotifier.class);
        AspectDiagnosticsWorkflow workflow = new AspectDiagnosticsWorkflow(coordinator, diagnosticsService, notifier);
        String uri = Path.of("pom.xml").toAbsolutePath().toUri().toString();
        AspectValidationResult result = mock(AspectValidationResult.class);
        when(coordinator.nextGeneration(uri)).thenReturn(3L);
        when(coordinator.currentGeneration(uri)).thenReturn(4L);
        doAnswer(invocation -> {
            BiConsumer<Long, AspectValidationResult> callback = invocation.getArgument(3);
            callback.accept(3L, result);
            return null;
        }).when(coordinator).submit(eq(uri), any(Path.class), eq(3L), any());

        workflow.onDocumentSaved(uri);

        verify(diagnosticsService, never()).updateAspect(uri, result);
        verify(notifier, never()).publishCombinedDiagnostics(uri);
    }

}
