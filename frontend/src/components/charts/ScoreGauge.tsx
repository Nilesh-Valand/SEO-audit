"use client";

export function ScoreGauge({ score }: { score: number | null }) {
  const normalized = score ?? 0;
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  const strokeOffset = circumference - (Math.max(0, Math.min(100, normalized)) / 100) * circumference;

  return (
    <div className="flex items-center justify-center">
      <div className="relative h-40 w-40">
        <svg className="h-40 w-40 -rotate-90" viewBox="0 0 140 140">
          <circle cx="70" cy="70" r={radius} stroke="#e5e7eb" strokeWidth="12" fill="none" />
          <circle
            cx="70"
            cy="70"
            r={radius}
            stroke="#0284c7"
            strokeWidth="12"
            strokeLinecap="round"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={strokeOffset}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-4xl font-bold text-gray-900">{score !== null ? Math.round(score) : "--"}</div>
          <div className="text-sm text-gray-500">Overall Score</div>
        </div>
      </div>
    </div>
  );
}
