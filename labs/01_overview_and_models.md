# Lab 01 — Bedrock 개요 & 모델 목록

## 목표
- Bedrock가 무엇인지 큰 그림 이해
- API로 모델 목록을 조회해보고, `modelId` 개념을 이해

## Steps
1) 서버 실행 후 모델 목록 호출
```bash
curl -s http://localhost:8080/api/models | jq '.count, .models[0:5]'
```

2) 프론트에서 **Models** 버튼을 눌러 목록 확인

## 체크포인트
- providerName / modelId 차이
- responseStreamingSupported 여부
- 리전별로 모델 목록이 달라질 수 있음
