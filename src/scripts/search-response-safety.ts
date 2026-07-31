const STRICT_UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates an unmodified response ID. Do not normalize or trim protocol values.
 */
export function isStrictUuid(value: unknown): value is string {
	return typeof value === 'string' && STRICT_UUID_PATTERN.test(value);
}
