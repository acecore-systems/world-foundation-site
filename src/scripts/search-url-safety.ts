const MAX_PATH_DECODE_PASSES = 2;
const MAX_URL_LENGTH = 2_048;

export function getSafePublicPathname(value: string): string | null {
	let pathname = value.normalize('NFKC');
	for (
		let pass = 0;
		pathname.includes('%') && pass < MAX_PATH_DECODE_PASSES;
		pass += 1
	) {
		if (/%(?:2f|5c)/iu.test(pathname)) return null;

		try {
			pathname = decodeURIComponent(pathname).normalize('NFKC');
		} catch {
			return null;
		}
	}

	pathname = pathname.normalize('NFKC');
	if (
		!pathname ||
		!pathname.startsWith('/') ||
		pathname.includes('%') ||
		pathname.includes('//') ||
		pathname.includes('\\') ||
		pathname.includes('?') ||
		pathname.includes('#') ||
		/\s/u.test(pathname) ||
		pathname
			.split('/')
			.some((segment) => segment === '.' || segment === '..') ||
		/[\u0000-\u001f\u007f]/u.test(pathname)
	) {
		return null;
	}

	const firstPathSegment = pathname.split('/')[1]?.toLowerCase();
	return ['admin', 'api'].includes(firstPathSegment) ? null : pathname;
}

export function getSafeInternalUrl(
	value: unknown,
	origin: string,
): string | null {
	if (typeof value !== 'string') return null;

	const rawUrl = value;
	if (
		!rawUrl ||
		[...rawUrl].length > MAX_URL_LENGTH ||
		!rawUrl.startsWith('/') ||
		rawUrl.startsWith('//') ||
		rawUrl.includes('\\') ||
		/[\s<>"']/u.test(rawUrl) ||
		/%(?:2f|5c)/iu.test(rawUrl)
	) {
		return null;
	}

	const pathname = getSafePublicPathname(rawUrl);
	if (!pathname) return null;

	try {
		const url = new URL(pathname, origin);
		if (
			url.origin !== origin ||
			url.username ||
			url.password ||
			url.port ||
			url.search ||
			url.hash
		) {
			return null;
		}

		return pathname;
	} catch {
		return null;
	}
}
