"use client";

import { useState, useCallback } from "react";
import {
  analyzeExcel,
  uploadToConfluence,
  notifySlack,
  type AnalysisResult,
  type ConfluenceResult,
} from "@/lib/api";

export type AnalysisStatus =
  | "idle"
  | "uploading"
  | "analyzing"
  | "done"
  | "error";

export function useAnalysis() {
  const [status, setStatus] = useState<AnalysisStatus>("idle");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confluenceUrl, setConfluenceUrl] = useState<string | null>(null);
  const [slackSent, setSlackSent] = useState(false);

  const analyze = useCallback(async (file: File, targetMonth?: string, nextMonthBusinessDays?: number) => {
    setStatus("uploading");
    setError(null);
    setResult(null);
    setConfluenceUrl(null);
    setSlackSent(false);

    try {
      setStatus("analyzing");
      const data = await analyzeExcel(file, targetMonth, nextMonthBusinessDays);
      setResult(data);
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류");
      setStatus("error");
    }
  }, []);

  const sendToConfluence = useCallback(async (): Promise<ConfluenceResult | null> => {
    if (!result) return null;
    try {
      const res = await uploadToConfluence(
        result.report.markdown,
        result.report.title
      );
      setConfluenceUrl(res.page_url);
      return res;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Confluence 업로드 실패");
      return null;
    }
  }, [result]);

  const sendToSlack = useCallback(async () => {
    if (!result) return;
    try {
      await notifySlack(
        result.report.markdown,
        result.report.title,
        confluenceUrl || undefined,
        result.summary.indicators,
        result.summary.one_liner
      );
      setSlackSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Slack 전송 실패");
    }
  }, [result, confluenceUrl]);

  const reset = useCallback(() => {
    setStatus("idle");
    setResult(null);
    setError(null);
    setConfluenceUrl(null);
    setSlackSent(false);
  }, []);

  return {
    status,
    result,
    error,
    confluenceUrl,
    slackSent,
    analyze,
    sendToConfluence,
    sendToSlack,
    reset,
  };
}
