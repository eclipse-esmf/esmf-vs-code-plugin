package com.example.turtlelsp.aspect.service;

import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.CancellationException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.BiConsumer;

import com.example.turtlelsp.aspect.model.AspectValidationError;
import com.example.turtlelsp.aspect.model.AspectValidationErrorType;
import com.example.turtlelsp.aspect.model.AspectValidationResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class AspectValidationCoordinator implements AutoCloseable {
    private static final Logger LOGGER = LoggerFactory.getLogger(AspectValidationCoordinator.class);

    private final AspectModelValidationService validationService;
    private final ExecutorService executorService;
    private final Map<String, CompletableFuture<?>> inFlight = new ConcurrentHashMap<>();
    private final Map<String, AtomicLong> generations = new ConcurrentHashMap<>();

    public AspectValidationCoordinator(AspectModelValidationService validationService) {
        this(validationService, Executors.newSingleThreadExecutor(Thread.ofPlatform().name("aspect-validation-", 0).factory()));
    }

    AspectValidationCoordinator(AspectModelValidationService validationService, ExecutorService executorService) {
        this.validationService = validationService;
        this.executorService = executorService;
    }

    public long nextGeneration(String uri) {
        return generations.computeIfAbsent(uri, ignored -> new AtomicLong()).incrementAndGet();
    }

    public long currentGeneration(String uri) {
        AtomicLong generation = generations.get(uri);
        return generation != null ? generation.get() : 0L;
    }

    public void cancel(String uri) {
        CompletableFuture<?> previous = inFlight.remove(uri);
        if (previous != null) {
            LOGGER.debug("[cancel] cancelling previous aspect validation for {}", uri);
            previous.cancel(true);
        }
    }

    public void submit(String uri, Path path, long generation, BiConsumer<Long, AspectValidationResult> callback) {
        cancel(uri);
        CompletableFuture<AspectValidationResult> future = CompletableFuture.supplyAsync(
            () -> validationService.validate(path),
            executorService
        );
        inFlight.put(uri, future);
        future.whenComplete((result, throwable) -> {
            inFlight.remove(uri, future);
            if (throwable instanceof CancellationException || future.isCancelled()) {
                LOGGER.debug("[cancel] aspect validation cancelled for {}", uri);
                return;
            }
            if (throwable != null) {
                LOGGER.error("[publish diagnostics] aspect validation failed for {}", uri, throwable);
                callback.accept(generation, new AspectValidationResult(
                    false,
                    throwable.getMessage(),
                    java.util.List.of(),
                    new AspectValidationError( AspectValidationErrorType.PROCESSING, throwable.getMessage())
                ));
                return;
            }
            callback.accept(generation, result);
        });
    }

    public AspectValidationResult validateSync(Path path) {
        return validationService.validate(path);
    }

    @Override
    public void close() {
        inFlight.values().forEach(future -> future.cancel(true));
        executorService.shutdownNow();
    }
}
