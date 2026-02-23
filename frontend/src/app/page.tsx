"use client";

import FileUpload from "@/components/FileUpload";
import AnalysisProgress from "@/components/AnalysisProgress";
import ReportPreview from "@/components/ReportPreview";
import ReportActions from "@/components/ReportActions";
import { useAnalysis } from "@/hooks/useAnalysis";

export default function Home() {
  const {
    status,
    result,
    error,
    confluenceUrl,
    slackSent,
    analyze,
    sendToConfluence,
    sendToSlack,
    reset,
  } = useAnalysis();

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">
            월간 채용 분석
          </h1>
          {status === "done" && (
            <button
              onClick={reset}
              className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              새 분석
            </button>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {status === "idle" && (
          <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">
              엑셀 파일 업로드
            </h2>
            <FileUpload onSubmit={analyze} />
          </section>
        )}

        {status !== "idle" && status !== "done" && (
          <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <AnalysisProgress status={status} error={error} />
            {error && (
              <button
                onClick={reset}
                className="mt-4 text-sm text-blue-600 hover:underline"
              >
                다시 시도
              </button>
            )}
          </section>
        )}

        {result && (
          <>
            {result.summary.indicators.length > 0 && (
              <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-800 mb-4">
                  Executive Summary
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {result.summary.indicators.map((ind, i) => (
                    <div
                      key={i}
                      className="p-3 bg-gray-50 rounded-lg border border-gray-100"
                    >
                      <div className="text-sm text-gray-500">{ind.metric}</div>
                      <div className="text-lg font-semibold mt-1">
                        {ind.emoji} {ind.result}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {ind.evaluation}
                      </div>
                    </div>
                  ))}
                </div>
                {result.summary.one_liner && (
                  <p className="mt-4 p-3 bg-blue-50 border-l-3 border-blue-400 text-sm text-blue-800 rounded-r-lg">
                    {result.summary.one_liner}
                  </p>
                )}
              </section>
            )}

            <section>
              <ReportPreview
                markdown={result.report.markdown}
                title={result.report.title}
                targetMonth={result.report.target_month}
              />
            </section>

            <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">
                리포트 내보내기
              </h2>
              <ReportActions
                markdown={result.report.markdown}
                title={result.report.title}
                onConfluence={sendToConfluence}
                onSlack={sendToSlack}
                confluenceUrl={confluenceUrl}
                slackSent={slackSent}
              />
            </section>
          </>
        )}
      </main>
    </div>
  );
}
