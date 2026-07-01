/**
 * GET /api/analyze/[jobId] — 분석 작업 상태 폴링
 */

import { NextResponse } from "next/server";
import { getJob } from "@/lib/analysis/job-store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const job = getJob(jobId);

  if (!job) {
    return NextResponse.json({ detail: "존재하지 않거나 만료된 작업입니다." }, { status: 404 });
  }

  if (job.status === "error") {
    return NextResponse.json({ detail: job.error || "분석 실패" }, { status: 500 });
  }

  if (job.status === "done") {
    return NextResponse.json(job.result);
  }

  return NextResponse.json({ status: "pending" }, { status: 202 });
}
