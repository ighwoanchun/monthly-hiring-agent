# 월간 채용 분석 에이전트

이 프로젝트는 채용 플랫폼의 월간 데이터를 분석하여 리포트를 생성합니다.

## 에이전트 역할

- 엑셀 파일(지표분석용_sheet.xlsx)을 읽고 분석
- Part A(실적)/Part B(파이프라인) 구조의 마크다운 리포트 생성
- Confluence 업로드 및 Slack 알림 (MCP 연동 시)
- Confluence 페이지 → PDF 아카이브 (과거 리포트를 AI가 참조할 지식 베이스로 누적)

## 리포트 생성

`/hiring-report` skill을 실행하면 리포트 양식, 데이터 구조, 용어 정의, 분석 규칙이 로드됩니다.

## 파이프라인 자동화

`python scripts/run_pipeline.py`로 리포트 생성 → Confluence 업로드 → PDF 아카이브 → Slack 알림을 한 번에 실행합니다.

- `scripts/export_pdf.py`: Confluence 페이지를 로컬 headless Chrome(print-to-pdf)으로 렌더링해 `archive/pdf/{YYYY-MM}.pdf`로 저장합니다. 별도 패키지 설치 없이 로컬 Google Chrome만 있으면 동작합니다.
- 각 단계는 `--skip-analysis` / `--skip-confluence` / `--skip-pdf` / `--skip-slack`로 개별 건너뛸 수 있습니다.
- ⚠️ Confluence 페이지 제목은 `run_pipeline.py`의 `extract_title()`이 리포트 md의 첫 H1을 그대로 사용합니다. 수동으로 다른 제목을 써서 먼저 업로드해둔 페이지가 있다면 제목을 반드시 일치시킬 것 — 다르면 중복 페이지가 생성됩니다.

## 파일 구조

```
monthly-hiring-agent/
├── CLAUDE.md                    # 이 파일 (자동 로드)
├── .claude/skills/hiring-report # 리포트 양식 및 분석 규칙
├── data/                        # 엑셀 파일 위치
├── output/                      # 생성된 마크다운 리포트
├── archive/pdf/                 # Confluence 리포트의 월별 PDF 아카이브 (AI 참조용 지식 베이스)
└── scripts/                     # 분석/업로드/아카이브 스크립트
```
