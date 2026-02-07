# Lab 03 — 스트리밍 채팅(SSE)

## 목표
- `ConverseStream`을 이용해 토큰(또는 델타) 단위로 응답 받기
- 프론트에서 실시간으로 글자가 찍히는 UX 구성

## Steps
1) 프론트에서 Stream 토글 ON 후 Send

2) curl로 SSE 보기
```bash
curl -N http://localhost:8080/api/chat/stream \
  -H "Content-Type: application/json" \
  -d '{
    "modelId": "YOUR_MODEL_ID",
    "messages": [{"role":"user","content":"3줄로 요약해줘: Amazon Bedrock 장점"}]
  }'
```

## 체크포인트
- 네트워크 프록시/로드밸런서에서 SSE buffering이 발생할 수 있음
