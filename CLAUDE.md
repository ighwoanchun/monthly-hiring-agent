# 월간 채용 분석 에이전트

이 프로젝트는 채용 플랫폼의 월간 데이터를 분석하여 리포트를 생성합니다.

## 에이전트 역할

- 엑셀 파일(지표분석용_sheet.xlsx)을 읽고 분석
- Part A(실적)/Part B(파이프라인) 구조의 마크다운 리포트 생성
- Confluence 업로드 및 Slack 알림 (MCP 연동 시)

## 리포트 생성

`/hiring-report` skill을 실행하면 리포트 양식, 데이터 구조, 용어 정의, 분석 규칙이 로드됩니다.

## 파일 구조

```
monthly-hiring-agent/
├── CLAUDE.md                    # 이 파일 (자동 로드)
├── .claude/skills/hiring-report # 리포트 양식 및 분석 규칙
├── data/                        # 엑셀 파일 위치
├── output/                      # 생성된 리포트
└── scripts/                     # 분석 스크립트
```
