import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const CLIENT_ID_HEADER = 'X-World-Foundation-Search-Client';
const DEFAULT_FIXTURE_FILE = fileURLToPath(
	new URL('../tests/fixtures/search-evaluation.json', import.meta.url),
);
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 128 * 1024;
const TOP_RESULT_COUNT = 3;
const CLIENT_RATE_LIMIT = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_ROLLOVER_MARGIN_MS = 1_000;
const SUPPORTED_LOCALES = new Set(['ja', 'en']);

export const DEFAULT_THRESHOLDS = Object.freeze({
	minExpectedTop3Rate: 0.6,
	minAcceptableTop3Rate: 0.8,
	minLocaleAcceptableTop3Rate: 0.7,
});

class SearchEvaluationError extends Error {
	constructor(code, message) {
		super(message);
		this.name = 'SearchEvaluationError';
		this.code = code;
	}
}

export function normalizeOrigin(value) {
	let url;
	try {
		url = new URL(String(value || '').trim());
	} catch {
		throw new SearchEvaluationError(
			'invalid_origin',
			'--origin must be a valid HTTPS origin.',
		);
	}

	if (
		url.protocol !== 'https:' ||
		!url.hostname ||
		url.username ||
		url.password ||
		url.pathname !== '/' ||
		url.search ||
		url.hash
	) {
		throw new SearchEvaluationError(
			'invalid_origin',
			'--origin must contain only an HTTPS scheme, host, and optional port.',
		);
	}

	return url.origin;
}

export function validateFixtures(value) {
	if (!Array.isArray(value) || value.length === 0) {
		throw new SearchEvaluationError(
			'invalid_fixtures',
			'Search evaluation fixtures must be a non-empty JSON array.',
		);
	}

	const seenIds = new Set();
	return value.map((fixture, index) => {
		if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) {
			throw invalidFixture(index, 'must be an object');
		}

		const id = String(fixture.id || '').trim();
		if (!/^[a-z0-9][a-z0-9-]{1,63}$/u.test(id) || seenIds.has(id)) {
			throw invalidFixture(index, 'must have a unique, stable id');
		}
		seenIds.add(id);

		const locale = String(fixture.locale || '').trim().toLowerCase();
		if (!SUPPORTED_LOCALES.has(locale)) {
			throw invalidFixture(index, 'must use locale ja or en');
		}

		if (typeof fixture.query !== 'string') {
			throw invalidFixture(index, 'must contain a query string');
		}
		const query = fixture.query.normalize('NFKC').replace(/\s+/gu, ' ').trim();
		const queryLength = [...query].length;
		if (
			queryLength < 2 ||
			queryLength > 160 ||
			/[\u0000-\u001f\u007f]/u.test(query) ||
			/[\ud800-\udfff]/u.test(query)
		) {
			throw invalidFixture(index, 'contains an invalid query');
		}

		const expected = normalizeFixtureRoutes(fixture.expected, index, 'expected');
		const alternate = normalizeFixtureRoutes(
			fixture.alternate ?? [],
			index,
			'alternate',
			true,
		);
		if (expected.some((route) => alternate.includes(route))) {
			throw invalidFixture(
				index,
				'must not repeat an expected route as an alternate',
			);
		}

		return Object.freeze({ id, locale, query, expected, alternate });
	});
}

export async function loadFixtures(fixtureFile = DEFAULT_FIXTURE_FILE) {
	let value;
	try {
		value = JSON.parse(await readFile(resolve(fixtureFile), 'utf8'));
	} catch (error) {
		throw new SearchEvaluationError(
			'invalid_fixtures',
			error instanceof SyntaxError
				? 'Search evaluation fixture JSON is invalid.'
				: 'Search evaluation fixture file could not be read.',
		);
	}
	return validateFixtures(value);
}

export async function evaluateFixture(
	fixture,
	{
		origin,
		clientId,
		fetchImpl = globalThis.fetch,
		timeoutMs = DEFAULT_TIMEOUT_MS,
	} = {},
) {
	const normalizedOrigin = normalizeOrigin(origin);
	assertClientId(clientId);
	assertTimeout(timeoutMs);

	const response = await fetchImpl(new URL('/api/search', normalizedOrigin), {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			Origin: normalizedOrigin,
			[CLIENT_ID_HEADER]: clientId,
		},
		body: JSON.stringify({
			query: fixture.query,
			locale: fixture.locale,
		}),
		cache: 'no-store',
		redirect: 'error',
		signal: AbortSignal.timeout(timeoutMs),
	});

	const payload = await readSearchResponse(response);
	const top3 = payload.results
		.slice(0, TOP_RESULT_COUNT)
		.map((result) => result.url);
	const expectedRank = firstMatchRank(top3, fixture.expected);
	const alternateRank = firstMatchRank(top3, fixture.alternate);
	const expectedHit = expectedRank !== null;
	const alternateHit = !expectedHit && alternateRank !== null;

	return {
		id: fixture.id,
		locale: fixture.locale,
		expectedHit,
		alternateHit,
		acceptableHit: expectedHit || alternateHit,
		hitRank: expectedRank ?? alternateRank,
		top3,
	};
}

export async function runEvaluation({
	fixtures,
	origin,
	locale,
	fetchImpl = globalThis.fetch,
	timeoutMs = DEFAULT_TIMEOUT_MS,
	thresholds = DEFAULT_THRESHOLDS,
	clientId = crypto.randomUUID(),
	logger = console,
	nowImpl = Date.now,
	sleepImpl = (milliseconds) =>
		new Promise((resolvePromise) =>
			setTimeout(resolvePromise, milliseconds),
		),
} = {}) {
	const normalizedOrigin = normalizeOrigin(origin);
	const normalizedFixtures = validateFixtures(fixtures);
	const normalizedThresholds = normalizeThresholds(thresholds);
	assertClientId(clientId);
	assertTimeout(timeoutMs);

	if (locale && !SUPPORTED_LOCALES.has(locale)) {
		throw new SearchEvaluationError(
			'invalid_locale',
			'--locale must be ja or en.',
		);
	}

	const selectedFixtures = locale
		? normalizedFixtures.filter((fixture) => fixture.locale === locale)
		: normalizedFixtures;
	if (selectedFixtures.length === 0) {
		throw new SearchEvaluationError(
			'empty_evaluation',
			'No fixtures match the selected locale.',
		);
	}

	const results = [];
	const rateLimitSchedule = createRateLimitSchedule({ nowImpl, sleepImpl });
	for (const fixture of selectedFixtures) {
		await rateLimitSchedule.beforeRequest(logger);
		try {
			const result = await evaluateFixture(fixture, {
				origin: normalizedOrigin,
				clientId,
				fetchImpl,
				timeoutMs,
			});
			results.push(result);
			logger.log(
				JSON.stringify({
					event: 'search_evaluation_case',
					fixtureId: result.id,
					locale: result.locale,
					expectedHit: result.expectedHit,
					alternateHit: result.alternateHit,
					acceptableHit: result.acceptableHit,
					hitRank: result.hitRank,
					top3: result.top3,
				}),
			);
		} catch (error) {
			const result = {
				id: fixture.id,
				locale: fixture.locale,
				expectedHit: false,
				alternateHit: false,
				acceptableHit: false,
				hitRank: null,
				top3: [],
				errorCode: getErrorCode(error),
			};
			results.push(result);
			logger.error(
				JSON.stringify({
					event: 'search_evaluation_case_error',
					fixtureId: result.id,
					locale: result.locale,
					errorCode: result.errorCode,
				}),
			);
		}
	}

	const summary = createSummary(results, normalizedThresholds);
	logger.log(JSON.stringify({ event: 'search_evaluation_summary', ...summary }));
	return summary;
}

function createRateLimitSchedule({ nowImpl, sleepImpl }) {
	let windowStart = null;
	let requestsInWindow = 0;

	return {
		async beforeRequest(logger) {
			let now = readCurrentTime(nowImpl);
			let currentWindowStart =
				Math.floor(now / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_WINDOW_MS;

			if (windowStart === null || currentWindowStart !== windowStart) {
				windowStart = currentWindowStart;
				requestsInWindow = 0;
			}

			if (requestsInWindow >= CLIENT_RATE_LIMIT) {
				const waitMs =
					windowStart +
					RATE_LIMIT_WINDOW_MS -
					now +
					RATE_LIMIT_ROLLOVER_MARGIN_MS;
				logger.log(
					JSON.stringify({
						event: 'search_evaluation_rate_limit_wait',
						waitMs,
						completedInWindow: requestsInWindow,
					}),
				);
				await sleepImpl(waitMs);

				now = readCurrentTime(nowImpl);
				currentWindowStart =
					Math.floor(now / RATE_LIMIT_WINDOW_MS) *
					RATE_LIMIT_WINDOW_MS;
				if (currentWindowStart === windowStart) {
					throw new SearchEvaluationError(
						'clock_not_advanced',
						'Clock did not advance into the next rate-limit window.',
					);
				}
				windowStart = currentWindowStart;
				requestsInWindow = 0;
			}

			requestsInWindow += 1;
		},
	};
}

export function createSummary(results, thresholds = DEFAULT_THRESHOLDS) {
	const normalizedThresholds = normalizeThresholds(thresholds);
	if (!Array.isArray(results) || results.length === 0) {
		throw new SearchEvaluationError(
			'empty_evaluation',
			'Search evaluation requires at least one result.',
		);
	}

	const total = results.length;
	const expectedHits = results.filter((result) => result.expectedHit).length;
	const alternateHits = results.filter((result) => result.alternateHit).length;
	const acceptableHits = results.filter(
		(result) => result.acceptableHit,
	).length;
	const errors = results.filter((result) => result.errorCode).length;
	const expectedTop3Rate = expectedHits / total;
	const acceptableTop3Rate = acceptableHits / total;

	const byLocale = {};
	for (const locale of [...SUPPORTED_LOCALES]) {
		const localeResults = results.filter((result) => result.locale === locale);
		if (localeResults.length === 0) continue;
		const localeAcceptableHits = localeResults.filter(
			(result) => result.acceptableHit,
		).length;
		byLocale[locale] = {
			total: localeResults.length,
			expectedHits: localeResults.filter((result) => result.expectedHit).length,
			alternateHits: localeResults.filter((result) => result.alternateHit).length,
			acceptableHits: localeAcceptableHits,
			acceptableTop3Rate: localeAcceptableHits / localeResults.length,
			errors: localeResults.filter((result) => result.errorCode).length,
		};
	}

	const failedChecks = [];
	if (errors > 0) failedChecks.push('response_errors');
	if (expectedTop3Rate < normalizedThresholds.minExpectedTop3Rate) {
		failedChecks.push('expected_top3_rate');
	}
	if (acceptableTop3Rate < normalizedThresholds.minAcceptableTop3Rate) {
		failedChecks.push('acceptable_top3_rate');
	}
	if (
		Object.values(byLocale).some(
			(value) =>
				value.acceptableTop3Rate <
				normalizedThresholds.minLocaleAcceptableTop3Rate,
		)
	) {
		failedChecks.push('locale_acceptable_top3_rate');
	}

	return {
		passed: failedChecks.length === 0,
		total,
		expectedHits,
		alternateHits,
		acceptableHits,
		errors,
		expectedTop3Rate,
		acceptableTop3Rate,
		byLocale,
		thresholds: normalizedThresholds,
		failedChecks,
	};
}

export function evaluationExitCode(summary) {
	return summary?.passed === true ? 0 : 1;
}

async function readSearchResponse(response) {
	if (!(response instanceof Response) && !isResponseLike(response)) {
		throw new SearchEvaluationError(
			'invalid_response',
			'Search API returned an invalid response object.',
		);
	}
	if (!response.ok) {
		throw new SearchEvaluationError(
			`http_${response.status}`,
			`Search API returned HTTP ${response.status}.`,
		);
	}

	const contentType = String(response.headers?.get?.('Content-Type') || '')
		.split(';', 1)[0]
		.trim()
		.toLowerCase();
	if (contentType !== 'application/json') {
		throw new SearchEvaluationError(
			'invalid_response',
			'Search API response must use application/json.',
		);
	}

	const text = await response.text();
	if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
		throw new SearchEvaluationError(
			'invalid_response',
			'Search API response is unexpectedly large.',
		);
	}

	let payload;
	try {
		payload = JSON.parse(text);
	} catch {
		throw new SearchEvaluationError(
			'invalid_response',
			'Search API response contains invalid JSON.',
		);
	}
	if (
		!payload ||
		typeof payload !== 'object' ||
		Array.isArray(payload) ||
		payload.ok !== true ||
		!Array.isArray(payload.results)
	) {
		throw new SearchEvaluationError(
			'invalid_response',
			'Search API response does not match the expected schema.',
		);
	}

	const results = payload.results.map((result) => {
		if (!result || typeof result !== 'object' || Array.isArray(result)) {
			throw new SearchEvaluationError(
				'invalid_response',
				'Search API result does not match the expected schema.',
			);
		}
		return { url: normalizeRoute(result.url, 'response result') };
	});

	return { results };
}

function normalizeFixtureRoutes(value, index, label, allowEmpty = false) {
	const values =
		typeof value === 'string' ? [value] : Array.isArray(value) ? value : null;
	if (!values || (!allowEmpty && values.length === 0)) {
		throw invalidFixture(index, `must contain ${label} routes`);
	}

	const routes = values.map((route) => {
		try {
			return normalizeRoute(route, `${label} route`);
		} catch {
			throw invalidFixture(index, `contains an invalid ${label} route`);
		}
	});
	if (new Set(routes).size !== routes.length) {
		throw invalidFixture(index, `contains duplicate ${label} routes`);
	}
	return routes;
}

function normalizeRoute(value, label) {
	if (
		typeof value !== 'string' ||
		!value.startsWith('/') ||
		value.startsWith('//') ||
		value.includes('\\') ||
		value.includes('?') ||
		value.includes('#') ||
		/\s/u.test(value) ||
		/[\u0000-\u001f\u007f]/u.test(value)
	) {
		throw new SearchEvaluationError(
			'invalid_route',
			`${label} must be a root-relative public route.`,
		);
	}
	const normalized = new URL(value, 'https://route.invalid').pathname;
	if (normalized !== value) {
		throw new SearchEvaluationError(
			'invalid_route',
			`${label} must use its canonical path form.`,
		);
	}
	return normalized;
}

function firstMatchRank(routes, candidates) {
	const index = routes.findIndex((route) => candidates.includes(route));
	return index < 0 ? null : index + 1;
}

function normalizeThresholds(value) {
	const thresholds = {
		minExpectedTop3Rate: Number(value?.minExpectedTop3Rate),
		minAcceptableTop3Rate: Number(value?.minAcceptableTop3Rate),
		minLocaleAcceptableTop3Rate: Number(value?.minLocaleAcceptableTop3Rate),
	};
	for (const [name, threshold] of Object.entries(thresholds)) {
		if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
			throw new SearchEvaluationError(
				'invalid_threshold',
				`${name} must be a number from 0 through 1.`,
			);
		}
	}
	return thresholds;
}

function assertClientId(value) {
	if (
		typeof value !== 'string' ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
			value,
		)
	) {
		throw new SearchEvaluationError(
			'invalid_client_id',
			'Search evaluation client id must be a UUID.',
		);
	}
}

function assertTimeout(value) {
	if (!Number.isInteger(value) || value < 100 || value > 60_000) {
		throw new SearchEvaluationError(
			'invalid_timeout',
			'Search evaluation timeout must be from 100 through 60000 milliseconds.',
		);
	}
}

function readCurrentTime(nowImpl) {
	const now = Number(nowImpl());
	if (!Number.isFinite(now) || now < 0) {
		throw new SearchEvaluationError(
			'invalid_clock',
			'Search evaluation clock returned an invalid time.',
		);
	}
	return now;
}

function invalidFixture(index, reason) {
	return new SearchEvaluationError(
		'invalid_fixtures',
		`Search evaluation fixture at index ${index} ${reason}.`,
	);
}

function getErrorCode(error) {
	if (
		error instanceof SearchEvaluationError &&
		/^[a-z][a-z0-9_]{0,63}$/u.test(error.code)
	) {
		return error.code;
	}
	if (error instanceof DOMException && error.name === 'TimeoutError') {
		return 'timeout';
	}
	return 'request_failed';
}

function isResponseLike(value) {
	return (
		Boolean(value) &&
		typeof value === 'object' &&
		typeof value.ok === 'boolean' &&
		Number.isInteger(value.status) &&
		typeof value.text === 'function'
	);
}

function parseCli(argv) {
	const { values } = parseArgs({
		args: argv,
		options: {
			origin: { type: 'string' },
			fixtures: { type: 'string', default: DEFAULT_FIXTURE_FILE },
			locale: { type: 'string' },
			'timeout-ms': {
				type: 'string',
				default: String(DEFAULT_TIMEOUT_MS),
			},
			'min-expected-rate': {
				type: 'string',
				default: String(DEFAULT_THRESHOLDS.minExpectedTop3Rate),
			},
			'min-acceptable-rate': {
				type: 'string',
				default: String(DEFAULT_THRESHOLDS.minAcceptableTop3Rate),
			},
			'min-locale-acceptable-rate': {
				type: 'string',
				default: String(
					DEFAULT_THRESHOLDS.minLocaleAcceptableTop3Rate,
				),
			},
		},
		allowPositionals: false,
		strict: true,
	});

	if (!values.origin) {
		throw new SearchEvaluationError(
			'missing_origin',
			'Usage: node scripts/evaluate-search.mjs --origin https://example.com',
		);
	}

	return {
		origin: normalizeOrigin(values.origin),
		fixtureFile: values.fixtures,
		locale: values.locale?.trim().toLowerCase(),
		timeoutMs: Number(values['timeout-ms']),
		thresholds: normalizeThresholds({
			minExpectedTop3Rate: values['min-expected-rate'],
			minAcceptableTop3Rate: values['min-acceptable-rate'],
			minLocaleAcceptableTop3Rate:
				values['min-locale-acceptable-rate'],
		}),
	};
}

function isDirectExecution() {
	if (!process.argv[1]) return false;
	return (
		resolve(process.argv[1]).toLowerCase() ===
		fileURLToPath(import.meta.url).toLowerCase()
	);
}

if (isDirectExecution()) {
	try {
		const options = parseCli(process.argv.slice(2));
		const fixtures = await loadFixtures(options.fixtureFile);
		const summary = await runEvaluation({ ...options, fixtures });
		process.exitCode = evaluationExitCode(summary);
	} catch (error) {
		console.error(
			JSON.stringify({
				event: 'search_evaluation_failed',
				errorCode: getErrorCode(error),
				message:
					error instanceof SearchEvaluationError
						? error.message
						: 'Search evaluation failed.',
			}),
		);
		process.exitCode = 1;
	}
}
