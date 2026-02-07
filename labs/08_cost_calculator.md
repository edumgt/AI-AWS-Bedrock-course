# Lab 08 — 비용 계산기(LLM + Guardrails)

이 랩은 레포의 **Cost 탭**을 이용해, “요청당 비용”과 “기간(요청 수) 기준 비용”을 빠르게 감 잡는 용도입니다.

> ⚠️ 주의: 토큰은 모델/토크나이저에 따라 달라집니다.  
> 운영 추정은 “실제 token usage(로그/메트릭)”를 기반으로 보정하는 것이 안전합니다.

---

## 1) 입력/출력 토큰 단가 넣기

Cost 탭 왼쪽 Settings에서:

- Price per 1,000 input tokens (USD)
- Price per 1,000 output tokens (USD)

을 입력합니다.

> 단가는 AWS Bedrock Pricing 페이지의 “On-Demand pricing”에서 모델별로 확인하세요.

---

## 2) 요청당 토큰 수 입력(또는 대략 추정)

### (권장) Manual token input
- 실제 운영/테스트에서 나온 토큰 사용량을 넣어 계산합니다.

### (간편) Sample prompt/answer로 추정
- Cost 탭 오른쪽에 대표 프롬프트/대표 응답을 붙여넣으면,
  - Korean-ish: chars/2
  - English-ish: chars/4  
  로 “대략” 토큰을 계산합니다.

---

## 3) Guardrails 비용 포함

Guardrails는 문자 기반 **text unit(최대 1000자)**로 과금됩니다.

- text units / request = ceil((input_chars + output_chars) / 1000)

Cost 탭에서 Guardrails 옵션을 켜면, 켠 필터만큼 단가가 합산됩니다.

---

## 4) 수업용 추천 시나리오

1) (가벼움) 1,000 요청/월, 짧은 답변(출력 토큰 낮게)
2) (일반) 10,000 요청/월, 요약/정책 응답
3) (비용 증가) 10,000 요청/월, 긴 답변 + Guardrails(여러 필터)

---

## 5) 확장 과제(선택)

- 백엔드에서 Bedrock 응답의 usage(입출력 토큰)를 받아 프론트로 전달
- 요청별 “실제 토큰 로그”를 쌓고, Cost 탭에서 평균/분산으로 비용 추정
