package com.example.turtlelsp.turtle.navigation;

import static org.assertj.core.api.Assertions.assertThat;

import org.eclipse.lsp4j.Location;
import org.eclipse.lsp4j.Position;
import org.junit.jupiter.api.Test;

class TurtlePrefixDefinitionServiceTest {
    private final TurtlePrefixDefinitionService service = new TurtlePrefixDefinitionService();

    @Test
    void extractsDeclaredPrefixAtPosition() {
        String content = """
            @prefix ex: <http://example.com/> .

            ex:Alice ex:name "Alice" .
            """;

        assertThat(service.findPrefixAtPosition(content, new Position(2, 1))).isEqualTo("ex");
    }

    @Test
    void extractsDefaultPrefixAtPosition() {
        String content = """
            @prefix : <http://example.com/> .

            :Entity a :Type .
            """;

        assertThat(service.findPrefixAtPosition(content, new Position(2, 1))).isEmpty();
    }

    @Test
    void returnsNullWhenPositionIsNotOnPrefixedName() {
        String content = """
            @prefix ex: <http://example.com/> .

            ex:Alice ex:name "Alice" .
            """;

        assertThat(service.findPrefixAtPosition(content, new Position(2, 18))).isNull();
    }

    @Test
    void findsMatchingPrefixDeclaration() {
        String content = """
            @prefix ex: <http://example.com/> .

            ex:Alice ex:name "Alice" .
            """;

        Location location = service.findPrefixDeclaration("file:///test.ttl", content, new Position(2, 1));

        assertThat(location.getRange().getStart().getLine()).isZero();
    }
}
