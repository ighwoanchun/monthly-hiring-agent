"use client";

import { useState, useRef, DragEvent } from "react";

interface FileUploadProps {
  onSubmit: (file: File, targetMonth?: string, nextMonthBusinessDays?: number) => void;
  disabled?: boolean;
}

export default function FileUpload({ onSubmit, disabled }: FileUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [targetMonth, setTargetMonth] = useState("");
  const [businessDays, setBusinessDays] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped && dropped.name.endsWith(".xlsx")) {
      setFile(dropped);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) setFile(selected);
  };

  const handleSubmit = () => {
    if (file) {
      const days = businessDays ? parseInt(businessDays, 10) : undefined;
      onSubmit(file, targetMonth || undefined, days || undefined);
    }
  };

  return (
    <div className="space-y-4">
      <div
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
          dragOver
            ? "border-blue-500 bg-blue-50"
            : file
            ? "border-green-400 bg-green-50"
            : "border-gray-300 hover:border-gray-400"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileChange}
          className="hidden"
        />

        {file ? (
          <div>
            <p className="text-lg font-medium text-green-700">{file.name}</p>
            <p className="text-sm text-gray-500 mt-1">
              {(file.size / 1024).toFixed(1)} KB
            </p>
          </div>
        ) : (
          <div>
            <svg
              className="mx-auto h-10 w-10 text-gray-400 mb-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <p className="text-gray-600">
              엑셀 파일을 드래그하거나 클릭하여 업로드
            </p>
            <p className="text-sm text-gray-400 mt-1">.xlsx 파일만 지원</p>
          </div>
        )}
      </div>

      <div className="flex gap-3 items-end">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            분석 대상월 (선택)
          </label>
          <input
            type="text"
            placeholder="예: 2026-01 (비워두면 자동 감지)"
            value={targetMonth}
            onChange={(e) => setTargetMonth(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="w-40">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            익월 영업일수 (선택)
          </label>
          <input
            type="number"
            min="1"
            max="31"
            placeholder="예: 22"
            value={businessDays}
            onChange={(e) => setBusinessDays(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={handleSubmit}
          disabled={!file || disabled}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          분석 시작
        </button>
      </div>
    </div>
  );
}
