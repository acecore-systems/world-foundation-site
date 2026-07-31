import { getSafeInternalUrl } from "../../src/scripts/search-url-safety.ts";

const EMBEDDING_MODEL = "text-embedding-3-large";
const EMBEDDING_DIMENSIONS = 1536;
const OPENAI_EMBEDDINGS_ENDPOINT = "https://api.openai.com/v1/embeddings";
const OPENAI_TIMEOUT_MS = 8_000;
const MAX_OPENAI_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_MIN_SCORE = 0.4;
const MAX_REQUEST_BYTES = 2048;
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 160;
const QUERY_TOP_K = 15;
const RESULT_LIMIT = 5;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_RETENTION_SECONDS = 600;
const CLIENT_RATE_LIMIT = 20;
const GLOBAL_RATE_LIMIT = 300;
const RATE_LIMIT_CLEANUP_BATCH_SIZE = 100;
const CLIENT_ID_HEADER = "X-World-Foundation-Search-Client";
const CLIENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_CODE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/;

const SUPPORTED_LOCALES = new Set(["ja", "en"]);

export type SemanticSearchEnv = {
  OPENAI_API_KEY?: string;
  OPENAI_EMBEDDING_MODEL?: string;
  OPENAI_EMBEDDING_DIMENSIONS?: string;
  SEARCH_INDEX?: Vectorize;
  SEARCH_RATE_LIMIT_DB?: D1Database;
  SEARCH_ENABLED?: string;
  SEARCH_MIN_SCORE?: string;
};

type SearchPayload = {
  query?: unknown;
  locale?: unknown;
};

type SearchMetadata = {
  url: string;
  title: string;
  section: string;
  excerpt: string;
  contentType: string;
  locale: string;
};

type SearchResult = {
  id: string;
  url: string;
  title: string;
  section: string;
  excerpt: string;
  contentType: string;
  rank: number;
};

class EmbeddingProviderError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "EmbeddingProviderError";
    this.code = code;
  }
}

export const onRequestPost: PagesFunction<SemanticSearchEnv> = async ({
  request,
  env,
}) => {
  const startedAt = performance.now();
  const requestId = crypto.randomUUID();

  try {
    if (!isSameOriginRequest(request)) {
      return errorResponse("forbidden", 403, requestId, startedAt);
    }

    if (!isJsonContentType(request.headers.get("Content-Type"))) {
      return errorResponse("unsupported_media_type", 415, requestId, startedAt);
    }

    const { OPENAI_API_KEY, SEARCH_INDEX, SEARCH_RATE_LIMIT_DB } = env;
    const openAiApiKey =
      typeof OPENAI_API_KEY === "string" ? OPENAI_API_KEY.trim() : "";
    const embeddingModel = env.OPENAI_EMBEDDING_MODEL || EMBEDDING_MODEL;
    const embeddingDimensions = Number(
      env.OPENAI_EMBEDDING_DIMENSIONS || EMBEDDING_DIMENSIONS,
    );
    if (
      env.SEARCH_ENABLED !== "true" ||
      !openAiApiKey ||
      embeddingModel !== EMBEDDING_MODEL ||
      embeddingDimensions !== EMBEDDING_DIMENSIONS ||
      !SEARCH_INDEX ||
      !SEARCH_RATE_LIMIT_DB
    ) {
      return errorResponse("unavailable", 503, requestId, startedAt);
    }

    const requestText = await readBoundedRequestText(
      request,
      MAX_REQUEST_BYTES,
    );
    if (requestText === null) {
      return errorResponse("request_too_large", 413, requestId, startedAt);
    }

    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(requestText);
    } catch {
      return errorResponse("invalid_json", 400, requestId, startedAt);
    }
    if (!isJsonObject(parsedPayload)) {
      return errorResponse("invalid_request", 400, requestId, startedAt);
    }

    const payload: SearchPayload = parsedPayload;
    const query = normalizeQuery(payload.query);
    const locale = normalizeLocale(payload.locale);
    if (!query || !locale) {
      return errorResponse("invalid_request", 400, requestId, startedAt);
    }

    let clientAllowed = false;
    let globalAllowed = false;
    try {
      globalAllowed = await consumeRateLimit(
        SEARCH_RATE_LIMIT_DB,
        "global",
        GLOBAL_RATE_LIMIT,
      );
      if (globalAllowed) {
        await deleteExpiredRateLimits(SEARCH_RATE_LIMIT_DB);
        const clientKey = await createClientRateLimitKey(request);
        clientAllowed = await consumeRateLimit(
          SEARCH_RATE_LIMIT_DB,
          `client:${clientKey}`,
          CLIENT_RATE_LIMIT,
        );
      }
    } catch (error) {
      logSearchError(
        requestId,
        "unknown",
        "rate_limit",
        getErrorCode(error, "storage_error"),
      );
      return errorResponse("unavailable", 503, requestId, startedAt);
    }

    if (!clientAllowed || !globalAllowed) {
      return errorResponse("rate_limited", 429, requestId, startedAt, {
        "Retry-After": String(RATE_LIMIT_WINDOW_SECONDS),
      });
    }

    let embedding: number[];
    try {
      embedding = await createOpenAiEmbedding({
        apiKey: openAiApiKey,
        query,
        model: embeddingModel,
        dimensions: embeddingDimensions,
        requestSignal: request.signal,
      });
    } catch (error) {
      if (request.signal.aborted) {
        return errorResponse("request_cancelled", 499, requestId, startedAt);
      }
      logSearchError(
        requestId,
        locale,
        "embedding",
        getErrorCode(error, "provider_error"),
      );
      return errorResponse("provider_error", 502, requestId, startedAt);
    }

    if (request.signal.aborted) {
      return errorResponse("request_cancelled", 499, requestId, startedAt);
    }

    let queryResult: unknown;
    try {
      queryResult = await SEARCH_INDEX.query(embedding, {
        namespace: locale,
        topK: QUERY_TOP_K,
        returnMetadata: "all",
        returnValues: false,
      });
    } catch (error) {
      logSearchError(
        requestId,
        locale,
        "vectorize",
        getErrorCode(error, "provider_error"),
      );
      return errorResponse("provider_error", 502, requestId, startedAt);
    }

    const results = normalizeMatches(
      queryResult,
      normalizeMinScore(env.SEARCH_MIN_SCORE),
      request.url,
      locale,
    );
    if (!results) {
      logSearchError(requestId, locale, "vectorize", "invalid_matches");
      return errorResponse("provider_error", 502, requestId, startedAt);
    }

    return jsonResponse(
      {
        ok: true,
        requestId,
        results,
      },
      200,
      requestId,
      startedAt,
    );
  } catch (error) {
    logSearchError(
      requestId,
      "unknown",
      "request",
      getErrorCode(error, "unknown_error"),
    );
    return errorResponse("internal_error", 500, requestId, startedAt);
  }
};

function normalizeQuery(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const query = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(query) ||
    /[\ud800-\udfff]/u.test(query)
  ) {
    return null;
  }

  const length = [...query].length;
  return length >= MIN_QUERY_LENGTH && length <= MAX_QUERY_LENGTH
    ? query
    : null;
}

function normalizeLocale(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const locale = value.trim().toLowerCase();
  return SUPPORTED_LOCALES.has(locale) ? locale : null;
}

function normalizeClientId(value: string | null): string {
  const clientId = String(value || "").trim();
  return CLIENT_ID_PATTERN.test(clientId)
    ? clientId.toLowerCase()
    : "anonymous";
}

async function readBoundedRequestText(
  request: Request,
  maxBytes: number,
): Promise<string | null> {
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null) {
    const normalizedLength = declaredLength.trim();
    if (!/^\d+$/u.test(normalizedLength)) return null;

    const length = Number(normalizedLength);
    if (!Number.isSafeInteger(length) || length > maxBytes) return null;
  }

  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel("request body too large").catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  return value.split(";", 1)[0].trim().toLowerCase() === "application/json";
}

async function createClientRateLimitKey(request: Request): Promise<string> {
  const source = `client:${normalizeClientId(
    request.headers.get(CLIENT_ID_HEADER),
  )}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source),
  );
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

async function consumeRateLimit(
  database: D1Database,
  limiterKey: string,
  limit: number,
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart =
    Math.floor(now / RATE_LIMIT_WINDOW_SECONDS) * RATE_LIMIT_WINDOW_SECONDS;
  const result = await database
    .prepare(
      `INSERT INTO semantic_search_rate_limits
        (limiter_key, window_start, request_count, expires_at)
       VALUES (?1, ?2, 1, ?3)
       ON CONFLICT (limiter_key, window_start) DO UPDATE SET
         request_count = semantic_search_rate_limits.request_count + 1,
         expires_at = excluded.expires_at
       WHERE semantic_search_rate_limits.request_count < ?4
       RETURNING request_count`,
    )
    .bind(limiterKey, windowStart, now + RATE_LIMIT_RETENTION_SECONDS, limit)
    .first<{ request_count: number }>();

  return Boolean(
    result &&
    Number.isInteger(result.request_count) &&
    result.request_count <= limit,
  );
}

async function deleteExpiredRateLimits(database: D1Database): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await database
    .prepare(
      `DELETE FROM semantic_search_rate_limits
       WHERE (limiter_key, window_start) IN (
         SELECT limiter_key, window_start
         FROM semantic_search_rate_limits
         WHERE expires_at < ?1
         ORDER BY expires_at
         LIMIT ?2
       )`,
    )
    .bind(now, RATE_LIMIT_CLEANUP_BATCH_SIZE)
    .run();
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

function normalizeMinScore(value: string | undefined): number {
  const normalizedValue = value?.trim();
  if (!normalizedValue) return DEFAULT_MIN_SCORE;

  const score = Number(normalizedValue);
  return Number.isFinite(score) && score >= 0 && score <= 1
    ? score
    : DEFAULT_MIN_SCORE;
}

async function createOpenAiEmbedding({
  apiKey,
  query,
  model,
  dimensions,
  requestSignal,
}: {
  apiKey: string;
  query: string;
  model: string;
  dimensions: number;
  requestSignal: AbortSignal;
}): Promise<number[]> {
  const requestController = new AbortController();
  let timedOut = false;
  const abortFromRequest = () => requestController.abort(requestSignal.reason);
  if (requestSignal.aborted) {
    abortFromRequest();
  } else {
    requestSignal.addEventListener("abort", abortFromRequest, { once: true });
  }
  const timeout = setTimeout(() => {
    timedOut = true;
    requestController.abort();
  }, OPENAI_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetch(OPENAI_EMBEDDINGS_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: [query],
          dimensions,
          encoding_format: "float",
        }),
        signal: requestController.signal,
      });
    } catch (error) {
      if (requestSignal.aborted) throw error;
      throw new EmbeddingProviderError(
        timedOut || isAbortError(error) ? "timeout" : "network_error",
      );
    }

    if (requestSignal.aborted) {
      await response.body?.cancel().catch(() => undefined);
      throw new DOMException("Request cancelled.", "AbortError");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new EmbeddingProviderError(`http_${response.status}`);
    }

    let payload: unknown;
    try {
      payload = await readBoundedOpenAiJson(response);
    } catch (error) {
      if (requestSignal.aborted) throw error;
      if (timedOut || isAbortError(error)) {
        throw new EmbeddingProviderError("timeout");
      }
      throw error;
    }
    const embedding = extractOpenAiEmbedding(payload, dimensions);
    if (!embedding) {
      throw new EmbeddingProviderError("invalid_embedding");
    }
    return embedding;
  } finally {
    clearTimeout(timeout);
    requestSignal.removeEventListener("abort", abortFromRequest);
  }
}

async function readBoundedOpenAiJson(response: Response): Promise<unknown> {
  const text = await readBoundedResponseText(
    response,
    MAX_OPENAI_RESPONSE_BYTES,
  );
  if (text === null) {
    throw new EmbeddingProviderError("response_too_large");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new EmbeddingProviderError("invalid_json");
  }
}

async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
): Promise<string | null> {
  const declaredLength = response.headers.get("Content-Length");
  if (declaredLength !== null) {
    const normalizedLength = declaredLength.trim();
    if (!/^\d+$/u.test(normalizedLength)) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }

    const length = Number(normalizedLength);
    if (!Number.isSafeInteger(length) || length > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
  }

  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel("response body too large").catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function extractOpenAiEmbedding(
  result: unknown,
  dimensions: number,
): number[] | null {
  if (!isJsonObject(result) || result.model !== EMBEDDING_MODEL) return null;
  const data = result.data;
  if (!Array.isArray(data) || data.length !== 1 || !isJsonObject(data[0])) {
    return null;
  }
  if (data[0].index !== 0 || !Array.isArray(data[0].embedding)) return null;

  const values = data[0].embedding;
  if (
    values.length !== dimensions ||
    !values.every(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value),
    )
  ) {
    return null;
  }
  return values;
}

function normalizeMatches(
  queryResult: unknown,
  minScore: number,
  requestUrl: string,
  locale: string,
): SearchResult[] | null {
  if (!isJsonObject(queryResult) || !Array.isArray(queryResult.matches)) {
    return null;
  }

  const results: SearchResult[] = [];
  const seenUrls = new Set<string>();

  for (const value of queryResult.matches) {
    if (!isJsonObject(value)) continue;

    const id = readMetadataText(value.id, 64);
    const score = value.score;
    if (
      !id ||
      typeof score !== "number" ||
      !Number.isFinite(score) ||
      score < minScore
    ) {
      continue;
    }

    const metadata = normalizeMetadata(value.metadata, requestUrl, locale);
    if (!metadata || seenUrls.has(metadata.url)) continue;

    seenUrls.add(metadata.url);
    results.push({
      id,
      url: metadata.url,
      title: metadata.title,
      section: metadata.section,
      excerpt: metadata.excerpt,
      contentType: metadata.contentType,
      rank: results.length + 1,
    });
    if (results.length >= RESULT_LIMIT) break;
  }

  return results;
}

function normalizeMetadata(
  value: unknown,
  requestUrl: string,
  expectedLocale: string,
): SearchMetadata | null {
  if (!isJsonObject(value)) return null;

  const url = normalizePublicUrl(value.url, requestUrl);
  const title = readMetadataText(value.title, 240);
  const section = readMetadataText(value.section, 240) || title;
  const excerpt = readMetadataText(value.excerpt, 500);
  const contentTypeValue = readMetadataText(value.contentType, 40);
  const contentType = /^[a-z0-9][a-z0-9_-]{0,39}$/i.test(contentTypeValue)
    ? contentTypeValue.toLowerCase()
    : "page";
  const locale = readMetadataText(value.locale, 16);

  if (!url || !title || locale !== expectedLocale) return null;
  return { url, title, section, excerpt, contentType, locale };
}

function normalizePublicUrl(value: unknown, requestUrl: string): string | null {
  if (typeof value !== "string" || [...value].length > 500) return null;

  try {
    const requestOrigin = new URL(requestUrl).origin;
    return getSafeInternalUrl(value, requestOrigin);
  } catch {
    return null;
  }
}

function readMetadataText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized) ||
    /[\ud800-\udfff]/u.test(normalized)
  ) {
    return "";
  }
  return [...normalized].slice(0, maxLength).join("");
}

function getErrorCode(error: unknown, fallback: string): string {
  if (error instanceof EmbeddingProviderError) return error.code;
  const name = error instanceof Error ? error.name : "";
  return ERROR_CODE_PATTERN.test(name) ? name : fallback;
}

function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function errorResponse(
  code: string,
  status: number,
  requestId: string,
  startedAt: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return jsonResponse(
    { ok: false, error: { code }, requestId },
    status,
    requestId,
    startedAt,
    extraHeaders,
  );
}

function jsonResponse(
  body: unknown,
  status: number,
  requestId: string,
  startedAt: number,
  extraHeaders: Record<string, string> = {},
): Response {
  const duration = Math.max(0, performance.now() - startedAt).toFixed(1);
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      "Content-Type": "application/json; charset=utf-8",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
      "Server-Timing": `search;dur=${duration}`,
      Vary: "Origin",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "X-Search-Request-Id": requestId,
      ...extraHeaders,
    },
  });
}

function logSearchError(
  requestId: string,
  locale: string,
  stage: string,
  errorCode: string,
): void {
  console.error(
    JSON.stringify({
      event: "semantic_search_error",
      requestId,
      locale,
      stage,
      errorCode,
    }),
  );
}
