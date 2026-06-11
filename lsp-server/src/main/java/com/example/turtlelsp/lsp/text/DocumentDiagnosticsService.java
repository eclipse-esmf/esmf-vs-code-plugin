package com.example.turtlelsp.lsp.text;

import java.util.List;

import com.example.turtlelsp.aspect.diagnostics.AspectDiagnosticMapper;
import com.example.turtlelsp.aspect.model.AspectValidationResult;
import org.eclipse.lsp4j.Diagnostic;

public class DocumentDiagnosticsService {
   private final TurtleSyntaxValidationService syntaxValidationService;
   private final AspectDiagnosticMapper aspectDiagnosticMapper;
   private final DocumentDiagnosticsStore diagnosticsStore;

   public DocumentDiagnosticsService() {
      this( new TurtleSyntaxValidationService(), new AspectDiagnosticMapper(), new DocumentDiagnosticsStore() );
   }

   DocumentDiagnosticsService(
         TurtleSyntaxValidationService syntaxValidationService,
         AspectDiagnosticMapper aspectDiagnosticMapper,
         DocumentDiagnosticsStore diagnosticsStore ) {
      this.syntaxValidationService = syntaxValidationService;
      this.aspectDiagnosticMapper = aspectDiagnosticMapper;
      this.diagnosticsStore = diagnosticsStore;
   }

   public void updateSyntax( String uri, String content ) {
      diagnosticsStore.putSyntax( uri, syntaxValidationService.validate( content ) );
   }

   public void updateAspect( String uri, AspectValidationResult result ) {
      diagnosticsStore.putAspect( uri, aspectDiagnosticMapper.toDiagnostics( uri, result ) );
   }

   public void clearAspect( String uri ) {
      diagnosticsStore.clearAspect( uri );
   }

   public void clearAll( String uri ) {
      diagnosticsStore.clear( uri );
   }

   public List<Diagnostic> getCombined( String uri ) {
      return diagnosticsStore.getCombined( uri );
   }
}
