package com.example.turtlelsp.lsp.text;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class DocumentStore {
   private final Map<String, String> documents = new ConcurrentHashMap<>();

   public void put( String uri, String content ) {
      documents.put( uri, content );
   }

   public String get( String uri ) {
      return documents.get( uri );
   }

   public String getOrDefault( String uri, String fallback ) {
      return documents.getOrDefault( uri, fallback );
   }

   public void remove( String uri ) {
      documents.remove( uri );
   }
}
