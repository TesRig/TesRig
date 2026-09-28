export interface SimulationSample {
  time: number;
  ux: number | null;
  uy: number | null;
  uz: number | null;
  error: number | null;
}

const NUMBER_PATTERN = "[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?";
const timePattern = new RegExp(`^\\s*Time\\s*=\\s*(${NUMBER_PATTERN})\\s*s?\\s*$`, "i");
const velocityPattern = new RegExp(
  `(?:volAverage|volumeAverage)\\s*\\([^)]*\\)(?:\\s+of\\s+U)?\\s*=\\s*\\(\\s*(${NUMBER_PATTERN})\\s+(${NUMBER_PATTERN})\\s+(${NUMBER_PATTERN})\\s*\\)`,
  "i",
);
const residualPattern = new RegExp(`Initial residual\\s*=\\s*(${NUMBER_PATTERN})`, "i");

export function parseSimulationSamples(log: string): SimulationSample[] {
  const samples: SimulationSample[] = [];
  let current: SimulationSample | null = null;
  const finishCurrent = () => {
    if (
      current &&
      [current.ux, current.uy, current.uz, current.error].some((value) => value !== null)
    ) {
      samples.push(current);
    }
  };

  for (const line of log.split(/\r?\n/)) {
    const timeMatch = line.match(timePattern);
    if (timeMatch) {
      finishCurrent();
      current = {
        time: Number(timeMatch[1]),
        ux: null,
        uy: null,
        uz: null,
        error: null,
      };
      continue;
    }
    if (!current) continue;

    const velocityMatch = line.match(velocityPattern);
    if (velocityMatch) {
      current.ux = Number(velocityMatch[1]);
      current.uy = Number(velocityMatch[2]);
      current.uz = Number(velocityMatch[3]);
    }
    const residualMatch = line.match(residualPattern);
    if (residualMatch) {
      const residual = Math.abs(Number(residualMatch[1]));
      if (Number.isFinite(residual)) current.error = Math.max(current.error ?? 0, residual);
    }
  }
  finishCurrent();
  return samples.filter((sample) => Number.isFinite(sample.time) && sample.time >= 0);
}

function average(values: Array<number | null>) {
  const validValues = values.filter((value): value is number => value !== null);
  if (validValues.length === 0) return null;
  return validValues.reduce((sum, value) => sum + value, 0) / validValues.length;
}

export function aggregateSimulationSamples(
  samples: SimulationSample[],
  maxPoints = 48,
): SimulationSample[] {
  if (samples.length <= maxPoints || maxPoints < 3) return samples;

  const aggregated: SimulationSample[] = [samples[0]];
  const interior = samples.slice(1, -1);
  const bucketCount = maxPoints - 2;

  for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
    const start = Math.floor((bucketIndex * interior.length) / bucketCount);
    const end = Math.floor(((bucketIndex + 1) * interior.length) / bucketCount);
    const bucket = interior.slice(start, Math.max(start + 1, end));
    aggregated.push({
      time: average(bucket.map(({ time }) => time)) ?? bucket[0].time,
      ux: average(bucket.map(({ ux }) => ux)),
      uy: average(bucket.map(({ uy }) => uy)),
      uz: average(bucket.map(({ uz }) => uz)),
      error: average(bucket.map(({ error }) => error)),
    });
  }

  aggregated.push(samples.at(-1)!);
  return aggregated;
}
