export function calculateRateOfRise(
  values: number[],
  timeSeconds: number[],
  index = values.length - 1,
): number | null {
  const currentValue = values[index];
  const currentTime = timeSeconds[index];
  if (!Number.isFinite(currentValue) || !Number.isFinite(currentTime)) return null;

  for (let i = index - 1; i >= 0; i -= 1) {
    const previousValue = values[i];
    const previousTime = timeSeconds[i];
    if (!Number.isFinite(previousValue) || !Number.isFinite(previousTime)) continue;

    const elapsedSeconds = currentTime - previousTime;
    if (elapsedSeconds > 0) {
      return ((currentValue - previousValue) / elapsedSeconds) * 60;
    }
  }

  return null;
}

export function buildRateOfRiseSeries(
  values: number[],
  timeSeconds: number[],
  windowSize = 20,
): Array<number | null> {
  const rate = values.map((_value, index) => calculateRateOfRise(values, timeSeconds, index));

  return rate.map((value, index, values) => {
    if (value == null || index < windowSize - 1) return value;
    const window = values
      .slice(index - windowSize + 1, index + 1)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (!window.length) return null;
    return window.reduce((sum, v) => sum + v, 0) / window.length;
  });
}
