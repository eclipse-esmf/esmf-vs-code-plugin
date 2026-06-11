package com.example.turtlelsp.lsp.text;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;

import com.example.turtlelsp.aspect.diagnostics.AspectDiagnosticMapper;
import com.example.turtlelsp.aspect.model.AspectValidationResult;
import org.eclipse.lsp4j.Diagnostic;
import org.junit.jupiter.api.Test;

class DocumentDiagnosticsServiceTest {
    @Test
    void updateSyntaxDelegatesToValidatorAndStore() {
        TurtleSyntaxValidationService syntaxValidationService = mock(TurtleSyntaxValidationService.class);
        AspectDiagnosticMapper aspectDiagnosticMapper = mock(AspectDiagnosticMapper.class);
        DocumentDiagnosticsStore diagnosticsStore = mock(DocumentDiagnosticsStore.class);
        DocumentDiagnosticsService service = new DocumentDiagnosticsService(
            syntaxValidationService,
            aspectDiagnosticMapper,
            diagnosticsStore
        );
        List<Diagnostic> diagnostics = List.of(new Diagnostic());
        when(syntaxValidationService.validate("content")).thenReturn(diagnostics);

        service.updateSyntax("file:///test.ttl", "content");

        verify(syntaxValidationService).validate("content");
        verify(diagnosticsStore).putSyntax("file:///test.ttl", diagnostics);
    }

    @Test
    void updateAspectDelegatesToMapperAndStore() {
        TurtleSyntaxValidationService syntaxValidationService = mock(TurtleSyntaxValidationService.class);
        AspectDiagnosticMapper aspectDiagnosticMapper = mock(AspectDiagnosticMapper.class);
        DocumentDiagnosticsStore diagnosticsStore = mock(DocumentDiagnosticsStore.class);
        DocumentDiagnosticsService service = new DocumentDiagnosticsService(
            syntaxValidationService,
            aspectDiagnosticMapper,
            diagnosticsStore
        );
        AspectValidationResult result = mock(AspectValidationResult.class);
        List<Diagnostic> diagnostics = List.of(new Diagnostic());
        when(aspectDiagnosticMapper.toDiagnostics("file:///test.ttl", result)).thenReturn(diagnostics);

        service.updateAspect("file:///test.ttl", result);

        verify(aspectDiagnosticMapper).toDiagnostics("file:///test.ttl", result);
        verify(diagnosticsStore).putAspect("file:///test.ttl", diagnostics);
    }

    @Test
    void clearAspectDelegatesToStore() {
        DocumentDiagnosticsStore diagnosticsStore = mock(DocumentDiagnosticsStore.class);
        DocumentDiagnosticsService service = new DocumentDiagnosticsService(
            mock(TurtleSyntaxValidationService.class),
            mock(AspectDiagnosticMapper.class),
            diagnosticsStore
        );

        service.clearAspect("file:///test.ttl");

        verify(diagnosticsStore).clearAspect("file:///test.ttl");
    }

    @Test
    void clearAllDelegatesToStore() {
        DocumentDiagnosticsStore diagnosticsStore = mock(DocumentDiagnosticsStore.class);
        DocumentDiagnosticsService service = new DocumentDiagnosticsService(
            mock(TurtleSyntaxValidationService.class),
            mock(AspectDiagnosticMapper.class),
            diagnosticsStore
        );

        service.clearAll("file:///test.ttl");

        verify(diagnosticsStore).clear("file:///test.ttl");
    }

    @Test
    void getCombinedDelegatesToStore() {
        DocumentDiagnosticsStore diagnosticsStore = mock(DocumentDiagnosticsStore.class);
        DocumentDiagnosticsService service = new DocumentDiagnosticsService(
            mock(TurtleSyntaxValidationService.class),
            mock(AspectDiagnosticMapper.class),
            diagnosticsStore
        );
        List<Diagnostic> diagnostics = List.of(new Diagnostic());
        when(diagnosticsStore.getCombined("file:///test.ttl")).thenReturn(diagnostics);

        List<Diagnostic> result = service.getCombined("file:///test.ttl");

        assertThat(result).isSameAs(diagnostics);
        verify(diagnosticsStore).getCombined("file:///test.ttl");
    }
}
