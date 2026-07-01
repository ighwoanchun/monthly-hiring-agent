/**
 * 분석 작업 상태를 메모리에 보관하는 잡 스토어.
 * K8s 인그레스 타임아웃(약 30초)을 넘기는 장시간 분석 요청을
 * 제출(POST)/폴링(GET) 방식으로 분리하기 위해 사용한다.
 */

import type { AnalysisResult } from "@/lib/api";

export type JobStatus = "pending" | "done" | "error";

export interface Job {
  id: string;
  status: JobStatus;
  result?: AnalysisResult;
  error?: string;
  createdAt: number;
}

const JOB_TTL_MS = 10 * 60 * 1000;

const jobs = new Map<string, Job>();

function cleanupOldJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) jobs.delete(id);
  }
}

export function createJob(): Job {
  cleanupOldJobs();
  const job: Job = { id: crypto.randomUUID(), status: "pending", createdAt: Date.now() };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function completeJob(id: string, result: AnalysisResult) {
  const job = jobs.get(id);
  if (!job) return;
  job.status = "done";
  job.result = result;
}

export function failJob(id: string, error: string) {
  const job = jobs.get(id);
  if (!job) return;
  job.status = "error";
  job.error = error;
}
