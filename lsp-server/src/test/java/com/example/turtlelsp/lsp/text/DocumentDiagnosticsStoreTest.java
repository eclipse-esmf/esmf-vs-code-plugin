package com.example.turtlelsp.lsp.text;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.eclipse.lsp4j.Diagnostic;
import org.junit.jupiter.api.Test;

class DocumentDiagnosticsStoreTest {
    @Test
    void combinesSyntaxAndAspectDiagnosticsInOrder() {
        DocumentDiagnosticsStore store = new DocumentDiagnosticsStore();
        Diagnostic syntax = new Diagnostic();
        syntax.setMessage("syntax");
        Diagnostic aspect = new Diagnostic();
        aspect.setMessage("aspect");

        store.putSyntax("file:///test.ttl", List.of(syntax));
        store.putAspect("file:///test.ttl", List.of(aspect));

        assertThat(store.getCombined("file:///test.ttl"))
            .extracting(Diagnostic::getMessage)
            .containsExactly("syntax", "aspect");
    }

    @Test
    void clearAspectKeepsSyntaxDiagnostics() {
        DocumentDiagnosticsStore store = new DocumentDiagnosticsStore();
        Diagnostic syntax = new Diagnostic();
        syntax.setMessage("syntax");
        Diagnostic aspect = new Diagnostic();
        aspect.setMessage("aspect");

        store.putSyntax("file:///test.ttl", List.of(syntax));
        store.putAspect("file:///test.ttl", List.of(aspect));
        store.clearAspect("file:///test.ttl");

        assertThat(store.getCombined("file:///test.ttl"))
            .extracting(Diagnostic::getMessage)
            .containsExactly("syntax");
    }
}
