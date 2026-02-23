"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ReportPreviewProps {
  markdown: string;
  title: string;
  targetMonth: string;
}

export default function ReportPreview({
  markdown,
  title,
  targetMonth,
}: ReportPreviewProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
        <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
          {targetMonth}
        </span>
      </div>
      <div className="prose max-w-none bg-white border border-gray-200 rounded-xl p-6 max-h-[600px] overflow-y-auto">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </div>
    </div>
  );
}
