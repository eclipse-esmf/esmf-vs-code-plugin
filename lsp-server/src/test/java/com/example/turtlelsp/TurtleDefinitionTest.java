package com.example.turtlelsp;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import com.example.turtlelsp.lsp.text.TurtleTextDocumentService;
import org.eclipse.lsp4j.DefinitionParams;
import org.eclipse.lsp4j.DidOpenTextDocumentParams;
import org.eclipse.lsp4j.InitializeResult;
import org.eclipse.lsp4j.Location;
import org.eclipse.lsp4j.Position;
import org.eclipse.lsp4j.TextDocumentIdentifier;
import org.eclipse.lsp4j.TextDocumentItem;
import org.eclipse.lsp4j.jsonrpc.messages.Either;
import org.junit.jupiter.api.Test;

class TurtleDefinitionTest {
    @Test
    void initializeAdvertisesDefinitionProvider() {
        TurtleLanguageServer server = new TurtleLanguageServer();

        InitializeResult result = server.initialize(null).join();

        assertThat(result.getCapabilities().getDefinitionProvider().getLeft()).isTrue();
    }

    @Test
    void findsDeclaredPrefixDefinition() {
        String content = """
            @prefix ex: <http://example.com/> .

            ex:Alice ex:name "Alice" .
            """;

        List<? extends Location> locations = definition(content, new Position(2, 1));

        assertThat(locations).hasSize(1);
        assertThat(locations.getFirst().getRange().getStart().getLine()).isZero();
    }

    @Test
    void returnsEmptyListWhenDocumentWasNotOpened() {
        TurtleTextDocumentService service = new TurtleTextDocumentService();
        Either<List<? extends Location>, List<? extends org.eclipse.lsp4j.LocationLink>> result = service.definition(
            new DefinitionParams(new TextDocumentIdentifier("file:///missing.ttl"), new Position(0, 0))
        ).join();

        assertThat(result.getLeft()).isEmpty();
    }

    private List<? extends Location> definition(String content, Position position) {
        TurtleTextDocumentService service = new TurtleTextDocumentService();
        String uri = "file:///test.ttl";
        service.didOpen(new DidOpenTextDocumentParams(new TextDocumentItem(uri, "turtle", 1, content)));

        Either<List<? extends Location>, List<? extends org.eclipse.lsp4j.LocationLink>> result = service.definition(
            new DefinitionParams(new TextDocumentIdentifier(uri), position)
        ).join();

        return result.getLeft();
    }
}
