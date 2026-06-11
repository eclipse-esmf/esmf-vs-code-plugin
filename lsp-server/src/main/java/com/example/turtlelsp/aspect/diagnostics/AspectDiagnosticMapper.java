package com.example.turtlelsp.aspect.diagnostics;

import java.net.URI;
import java.util.List;

import com.example.turtlelsp.aspect.model.AspectValidationResult;
import com.example.turtlelsp.aspect.model.AspectViolationInfo;
import org.eclipse.lsp4j.Diagnostic;
import org.eclipse.lsp4j.DiagnosticSeverity;
import org.eclipse.lsp4j.Position;
import org.eclipse.lsp4j.Range;
import org.eclipse.lsp4j.jsonrpc.messages.Either;

public final class AspectDiagnosticMapper {
    public static final String SOURCE = "lsp-server.aspect";

    public List<Diagnostic> toDiagnostics(String documentUri, AspectValidationResult result) {
        return result.violations().stream()
            .filter(violation -> appliesToDocument(documentUri, violation))
            .map(this::toDiagnostic)
            .toList();
    }

    private boolean appliesToDocument(String documentUri, AspectViolationInfo violation) {
        if (violation.sourceLocation() == null) {
            return true;
        }

        return URI.create(documentUri).equals(violation.sourceLocation());
    }

    private Diagnostic toDiagnostic(AspectViolationInfo violation) {
        Diagnostic diagnostic = new Diagnostic();
        diagnostic.setSource(SOURCE);
        diagnostic.setSeverity(DiagnosticSeverity.Error);
        diagnostic.setMessage(violation.message());
        diagnostic.setCode(Either.forLeft(violation.code()));
        diagnostic.setRange(toRange(violation));
        return diagnostic;
    }

    private Range toRange(AspectViolationInfo violation) {
        long line = violation.line() != null ? violation.line() : 1L;
        long column = violation.column() != null ? violation.column() : 1L;
        int safeLine = (int) Math.max(0, line - 1);
        int safeColumn = (int) Math.max(0, column - 1);
        return new Range(new Position(safeLine, safeColumn), new Position(safeLine, safeColumn + 1));
    }
}
