function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function providerMetricValues(value: unknown): Array<[string, number]> {
  if (!record(value)) return [];
  if (!Array.isArray(value.providerData)) {
    return Object.entries(value)
      .filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === "number" && Number.isFinite(entry[1]),
      )
      .slice(0, 12);
  }
  const result: Array<[string, number]> = [];
  for (const item of value.providerData) {
    if (!record(item) || typeof item.name !== "string") continue;
    const total = record(item.total_value) ? item.total_value.value : null;
    const single =
      Array.isArray(item.values) &&
      item.values.length === 1 &&
      record(item.values[0])
        ? item.values[0].value
        : null;
    const number = typeof total === "number" ? total : single;
    if (typeof number === "number" && Number.isFinite(number)) {
      result.push([item.name, number]);
    }
    if (result.length >= 12) break;
  }
  return result;
}

export function providerCollectedAt(value: unknown): Date | null {
  if (!record(value) || typeof value.collectedAt !== "string") return null;
  const date = new Date(value.collectedAt);
  return Number.isFinite(date.getTime()) ? date : null;
}
