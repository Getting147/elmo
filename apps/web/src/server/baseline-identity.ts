/** Encode tenant identities for HTTP transport without changing their stored identity. */
export function baselineIdentityHeaders(
	organizationId: string,
	brandId: string,
	callerId: string,
): Record<string, string> {
	const identities = { "X-Organization-Id": organizationId, "X-Brand-Id": brandId, "X-Caller-Id": callerId };
	if (Object.values(identities).every((value) => /^[\x20-\x7e]*$/.test(value))) return identities;
	return {
		...Object.fromEntries(Object.entries(identities).map(([key, value]) => [key, encodeURIComponent(value)])),
		"X-Tenant-Id-Encoding": "utf-8-percent",
	};
}
