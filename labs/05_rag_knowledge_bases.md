# Lab 05 — Knowledge Bases 기반 RAG

## 목표
- Knowledge Base(지식베이스)로 RAG 구현
- `/api/rag`로 질의하고 인용(citations)을 확인

## 사전 준비(콘솔)
1) S3 버킷에 문서 업로드(PDF/TXT/MD 등)
2) Bedrock Knowledge Bases에서 KB 생성
3) `knowledgeBaseId` 확인

## 실행
```bash
curl -s http://localhost:8080/api/rag \
  -H "Content-Type: application/json" \
  -d '{
    "knowledgeBaseId": "YOUR_KB_ID",
    "query": "업로드한 문서 기준으로 핵심 결론 5개 요약해줘"
  }' | jq .
```

## 체크포인트
- citations에 source/offset 등 근거가 포함될 수 있음
- 권한(AccessDenied) 발생 시 IAM 정책 확인
