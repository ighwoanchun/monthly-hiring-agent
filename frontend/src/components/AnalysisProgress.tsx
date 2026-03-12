"use client";

import type { AnalysisStatus } from "@/hooks/useAnalysis";

interface AnalysisProgressProps {
  status: AnalysisStatus;
  error: string | null;
}

const steps = [
  { key: "uploading", label: "파일 업로드" },
  { key: "analyzing", label: "AI 분석 중" },
  { key: "done", label: "리포트 생성 완료" },
] as const;

export default function AnalysisProgress({
  status,
  error,
}: AnalysisProgressProps) {
  if (status === "idle") return null;

  const currentIdx = steps.findIndex((s) => s.key === status);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {steps.map((step, i) => {
          const isActive = step.key === status;
          const isDone =
            status === "done" || (currentIdx > i && status !== "error");
          const isError = status === "error" && step.key === "analyzing";

          return (
            <div key={step.key} className="flex items-center gap-2">
              {i > 0 && (
                <div
                  className={`h-px w-8 ${
                    isDone ? "bg-green-400" : "bg-gray-300"
                  }`}
                />
              )}
              <div className="flex items-center gap-2">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${
                    isDone
                      ? "bg-green-500 text-white"
                      : isError
                      ? "bg-red-500 text-white"
                      : isActive
                      ? "bg-blue-500 text-white"
                      : "bg-gray-200 text-gray-500"
                  }`}
                >
                  {isDone ? (
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  ) : isError ? (
                    "!"
                  ) : (
                    i + 1
                  )}
                </div>
                <span
                  className={`text-sm ${
                    isActive ? "font-semibold text-blue-700" : "text-gray-500"
                  } ${isDone ? "text-green-700" : ""} ${
                    isError ? "text-red-600" : ""
                  }`}
                >
                  {step.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {status === "analyzing" && (
        <div className="flex items-center gap-2 text-sm text-blue-600">
          <svg
            className="animate-spin h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          AI가 데이터를 분석하고 리포트를 생성하고 있습니다...
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
