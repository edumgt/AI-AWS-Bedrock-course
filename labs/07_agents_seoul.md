# Lab 07 — Bedrock Agents (서울 ap-northeast-2)

> 이 랩은 **서울 리전(ap-northeast-2)**에서 **Agents for Amazon Bedrock**를 생성하고,
> 로컬 Node.js 백엔드에서 `InvokeAgent`로 호출(스트리밍 포함)하는 흐름을 실습합니다.

---

## 0) 핵심 개념(쉽게)

### Agent란?
- **대화형 LLM + 도구(툴) + 지식베이스(RAG) + 오케스트레이션**을 하나로 묶어,
  “목표를 달성하는 앱”처럼 동작하게 만드는 Bedrock 기능입니다.

### 자주 나오는 ID 3개
- `agentId`: 에이전트 자체의 ID
- `agentAliasId`: 배포/버전 개념. 운영에서는 보통 `dev`, `prod` 같은 Alias로 고정 호출
- `sessionId`: 동일 세션에서 컨텍스트를 이어갈 때 사용(채팅방 ID 같은 역할)

---

## 1) 사전 체크(서울 리전)

- `.env`에서 `AWS_REGION=ap-northeast-2` 설정
- Bedrock 콘솔에서 **Model access**가 활성화되어야 함
- Agents는 `ap-northeast-2`에서 지원됨 (서울 리전 OK)

---

## 2) 콘솔에서 Agent 만들기(가장 쉬운 방법)

### Step A. Agent 생성
1) Bedrock 콘솔 → **Agents** → Create agent
2) Foundation model 선택
3) Agent instructions(시스템 프롬프트에 해당) 입력  
   예: “너는 DevOps 멘토다. 사용자의 EKS 질문에 단계별로 답한다.”

### Step B. Alias 생성
1) Agent 상세 화면 → **Aliases** → Create alias
2) 예: alias name = `dev`
3) 생성 후 `agentAliasId` 확인

> (선택) Knowledge Base 연결 또는 Action Group 연결  
> - Knowledge Base: 문서 기반 답변(RAG)
> - Action Group: Lambda/HTTP API 등 외부 도구 호출

---

## 3) API로 InvokeAgent 호출(비스트리밍)

```bash
curl -s http://localhost:8080/api/agent/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "YOUR_AGENT_ID",
    "agentAliasId": "YOUR_AGENT_ALIAS_ID",
    "inputText": "EKS에서 ALB Ingress Controller 설치 순서를 5단계로 알려줘",
    "enableTrace": false
  }' | jq .
```

응답:
- `text`: 에이전트 답변
- `sessionId`: 다음 질문에서 재사용하면 컨텍스트 유지

---

## 4) API로 InvokeAgent 호출(스트리밍 SSE)

```bash
curl -N http://localhost:8080/api/agent/stream \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "YOUR_AGENT_ID",
    "agentAliasId": "YOUR_AGENT_ALIAS_ID",
    "inputText": "EKS에서 Private Subnet 노드그룹을 만들 때 체크포인트는?",
    "enableTrace": false
  }'
```

- `type=delta` 이벤트가 오면 화면에 바로바로 이어 붙이면 됩니다.

---

## 5) (선택) Trace 켜보기

> Trace는 내부 reasoning/툴 호출 경로 등을 포함할 수 있어 크기가 커질 수 있습니다.

```bash
curl -N http://localhost:8080/api/agent/stream \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "YOUR_AGENT_ID",
    "agentAliasId": "YOUR_AGENT_ALIAS_ID",
    "inputText": "가드레일을 적용할 때 주의점은?",
    "enableTrace": true
  }'
```

---

## 6) 실습 과제

1) Agent instructions를 3가지 버전으로 바꿔보고 답변 스타일 비교
2) Knowledge Base 연결 후 “업로드 문서 기반” 답변이 나오는지 확인
3) sessionId를 유지한 상태로 3턴 대화 시나리오 만들기
