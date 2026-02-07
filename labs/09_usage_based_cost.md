# Lab 09 — 실제 usage(토큰) 기반 비용 추정

## 목표
- Bedrock 응답에서 제공되는 usage(입력/출력/합계 토큰)를 서버가 기록
- Cost 탭에서 최근 N회 평균 토큰/평균 비용을 자동으로 계산

---

## 1) usage가 쌓이는 대상
- `/api/chat` (Converse)
- `/api/chat/stream` (ConverseStream) — 스트림 종료 시 usage 저장
- `/api/agent/invoke`, `/api/agent/stream` (InvokeAgent)
  - ⚠️ Agent는 token usage가 trace에 포함되지 않는 경우가 있어,
    이때는 **estimated=true**로 “문자 기반 추정”으로 저장됩니다.

---

## 2) API로 확인
### 최근 목록
```bash
curl -s "http://localhost:8080/api/usage/recent?limit=10" | jq .
```

### 요약(평균)
```bash
curl -s "http://localhost:8080/api/usage/summary?limit=100" | jq .
```

---

## 3) Cost 탭에서 자동 반영
- Cost 탭에서 단가 입력 후,
- 아래 “Recent usage summary”가 자동으로 갱신됩니다.

---

## 4) 확장 과제(선택)
- in-memory 대신 파일/DB로 저장
- userId/sessionId 별로 분리 집계
- CloudWatch Logs로 JSON 구조화 로그 전송 후 메트릭/대시보드 구성
