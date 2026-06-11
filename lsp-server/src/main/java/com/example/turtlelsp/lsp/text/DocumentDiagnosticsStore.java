package com.example.turtlelsp.lsp.text;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.eclipse.lsp4j.Diagnostic;

public class DocumentDiagnosticsStore {
   private final Map<String, List<Diagnostic>> syntaxDiagnostics = new ConcurrentHashMap<>();
   private final Map<String, List<Diagnostic>> aspectDiagnostics = new ConcurrentHashMap<>();

   public void putSyntax( String uri, List<Diagnostic> diagnostics ) {
      syntaxDiagnostics.put( uri, List.copyOf( diagnostics ) );
   }

   public void putAspect( String uri, List<Diagnostic> diagnostics ) {
      aspectDiagnostics.put( uri, List.copyOf( diagnostics ) );
   }

   public void clearAspect( String uri ) {
      aspectDiagnostics.remove( uri );
   }

   public void clear( String uri ) {
      syntaxDiagnostics.remove( uri );
      aspectDiagnostics.remove( uri );
   }

   public List<Diagnostic> getCombined( String uri ) {
      List<Diagnostic> diagnostics = new ArrayList<>();
      diagnostics.addAll( syntaxDiagnostics.getOrDefault( uri, List.of() ) );
      diagnostics.addAll( aspectDiagnostics.getOrDefault( uri, List.of() ) );
      return diagnostics;
   }
}
