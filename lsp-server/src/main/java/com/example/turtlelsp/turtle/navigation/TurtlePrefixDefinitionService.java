package com.example.turtlelsp.turtle.navigation;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.eclipse.lsp4j.Location;
import org.eclipse.lsp4j.Position;
import org.eclipse.lsp4j.Range;

public class TurtlePrefixDefinitionService {
    private static final Pattern PREFIX_DECLARATION_PATTERN = Pattern.compile(
        "^\\s*@prefix\\s+([A-Za-z][A-Za-z0-9_-]*)?:\\s*<[^>]*>\\s*\\.",
        Pattern.CASE_INSENSITIVE
    );

    public Location findPrefixDeclaration(String uri, String content, Position position) {
        String prefix = findPrefixAtPosition(content, position);
        if (prefix == null) {
            return null;
        }

        String[] lines = content.split("\\R", -1);
        for (int line = 0; line < lines.length; line++) {
            Matcher matcher = PREFIX_DECLARATION_PATTERN.matcher(lines[line]);
            if (!matcher.find()) {
                continue;
            }

            String declaredPrefix = matcher.group(1);
            String normalizedPrefix = declaredPrefix == null ? "" : declaredPrefix;
            if (!normalizedPrefix.equals(prefix)) {
                continue;
            }

            return new Location(uri, new Range(new Position(line, 0), new Position(line, lines[line].length())));
        }

        return null;
    }

   public String findPrefixAtPosition(String content, Position position) {
        int lineStart = 0;
        int currentLine = 0;
        while (currentLine < position.getLine() && lineStart < content.length()) {
            if (content.charAt(lineStart++) == '\n') {
                currentLine++;
            }
        }
        if (currentLine != position.getLine()) {
            return null;
        }

        int lineEnd = lineStart;
        while (lineEnd < content.length() && content.charAt(lineEnd) != '\n') {
            lineEnd++;
        }

        int character = Math.max(0, Math.min(position.getCharacter(), lineEnd - lineStart));
        int offset = lineStart + character;
        if (offset > lineStart && (offset == lineEnd || !isPrefixedNameChar(content.charAt(offset)))) {
            offset--;
        }
        if (offset < lineStart || offset >= lineEnd || !isPrefixedNameChar(content.charAt(offset))) {
            return null;
        }

        int start = offset;
        while (start > lineStart && isPrefixedNameChar(content.charAt(start - 1))) {
            start--;
        }

        int end = offset + 1;
        while (end < lineEnd && isPrefixedNameChar(content.charAt(end))) {
            end++;
        }

        String token = content.substring(start, end);
        int colonIndex = token.indexOf(':');
        if (colonIndex < 0 || colonIndex == token.length() - 1) {
            return null;
        }

        String prefix = token.substring(0, colonIndex);
        String localPart = token.substring(colonIndex + 1);
        if (localPart.isEmpty()) {
            return null;
        }

        return prefix;
    }

    private boolean isPrefixedNameChar(char ch) {
        return Character.isLetterOrDigit(ch) || ch == ':' || ch == '_' || ch == '-';
    }
}
