# Lab 10: Bedrock Course Starter를 SaaS로 확장하기

이 문서는 현재 레포를 **멀티 테넌트 SaaS**로 발전시키기 위한 분석 + 구현 가이드를 제공합니다.

## 1) 현재 상태 분석

현재 코드는 교육용으로 매우 좋지만, SaaS 관점에서 아래가 부족합니다.

- 테넌트 식별/격리
- 플랜(Free/Pro/Enterprise) 정책
- 요청당 레이트 리밋(RPM)
- 월별 토큰 쿼터 관리
- 테넌트별 usage 분리

## 2) 이번 단계에서 추가된 SaaS 기능

백엔드에 아래가 추가되었습니다.

1. **Tenant Resolver**
   - `x-api-key` 또는 `x-tenant-id` 헤더로 테넌트 식별
   - 환경변수 `SAAS_API_KEYS` 기반 매핑

2. **Plan 정책**
   - Free / Pro / Enterprise
   - 월 토큰 한도, RPM, 기능 플래그(RAG/Agent 허용 여부)

3. **Quota / Rate Limit 미들웨어**
   - `enforceRateLimit`: 분당 요청 수 제한
   - `enforceTokenQuota`: 월 누적 토큰 제한

4. **테넌트별 Usage 기록**
   - 기존 `usageStore`에 `tenantId` 추가
   - `/api/usage/*` 응답도 현재 테넌트 기준으로 분리

5. **SaaS 관리 API**
   - `GET /api/saas/plans`
   - `GET /api/saas/tenant`
   - `GET /api/saas/tenants`

## 3) 환경변수

```bash
SAAS_API_KEYS=team-a:key-a:free,team-b:key-b:pro,team-c:key-c:enterprise
USAGE_MAX=2000
```

요청 예시:

```bash
curl -H "x-api-key: key-b" http://localhost:8080/api/saas/tenant
```

## 4) SaaS 고도화 로드맵 (다음 단계)

- **DB 영속화**: in-memory -> DynamoDB/PostgreSQL
- **인증/인가**: Cognito + JWT + RBAC
- **청구/결제**: Stripe + usage meter
- **감사로그**: tenant/user/request 단위 trace
- **관리자 콘솔**: 테넌트 생성, 플랜 변경, 쿼터 조정
- **보안**: KMS 암호화, WAF, private subnet, VPC endpoint
- **운영성**: CloudWatch Dashboard + 알람 + SLO

## 5) 권장 아키텍처

- API: Express (현재) -> ECS/Fargate 또는 Lambda/API Gateway
- 데이터: DynamoDB(usage meter), Aurora(PostgreSQL, billing metadata)
- 인증: Cognito User Pool + Authorizer
- 결제: Stripe Webhook -> Billing Service
- 비동기 이벤트: EventBridge + SQS

