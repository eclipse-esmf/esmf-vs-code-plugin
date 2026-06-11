package com.example.turtlelsp.common.uri;

import java.net.URI;
import java.nio.file.Path;
import java.nio.file.Paths;

public final class DocumentUriResolver {
    private DocumentUriResolver() {
    }

    public static Path toPath(String uri) {
        if (uri == null || !uri.startsWith("file:")) {
            return null;
        }

        return Paths.get(URI.create(uri));
    }
}
