# Lab 02 — Converse로 채팅 만들기

## 목표
- `Converse` API로 기본 채팅 호출
- system prompt / temperature / maxTokens를 바꿔보며 결과 비교

## Steps
1) 프론트에서
- Model ID 선택
- System prompt 입력(예: '너는 친절한 DevOps 멘토야')
- User message 입력
- Send

2) curl로 직접 호출
```bash
curl -s http://localhost:8080/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "modelId": "YOUR_MODEL_ID",
    "system": "너는 친절한 DevOps 멘토야.",
    "messages": [{"role":"user","content":"EKS에서 Ingress는 왜 필요해?"}],
    "temperature": 0.3,
    "maxTokens": 512
  }' | jq .
```

## 체크포인트
- 모델마다 입력 포맷/옵션 차이가 있을 수 있음(Converse는 통일된 인터페이스)
- stopReason / usage 확인
