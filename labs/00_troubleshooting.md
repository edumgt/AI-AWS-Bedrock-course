# Troubleshooting — 응답이 없거나 500 + HTML(<!DOCTYPE>)가 나올 때

## 증상
- UI에서 Send 했는데 assistant 응답이 비어있음
- DevTools Console에:
  - `POST /api/chat 500`
  - `Unexpected token '<' ... "<!DOCTYPE ... is not valid JSON"`

## 원인
- 백엔드가 500을 내면서 **JSON이 아닌 HTML 에러 페이지**를 반환하거나,
- Vite 프록시가 백엔드 연결 실패 시 HTML 오류 페이지를 반환하는 경우

## 해결
1) 백엔드 생존 확인
- `http://localhost:8080/api/health` → `{"ok":true}`

2) Network 탭 확인
- `/api/chat` Response 확인
- JSON으로 `error/message`가 보이면 그 내용을 기준으로 해결

3) AWS 인증 확인
```bash
aws sts get-caller-identity
```
- 실패하면 `aws sso login` 또는 AccessKey/SessionToken 설정 점검

## 패치 내용(이 레포)
- API는 이제 항상 JSON으로 에러를 반환하도록 global error handler가 있습니다.
- 프론트는 JSON이 아닌 응답을 받으면 `❌ ...` 형태로 채팅창에 에러 메시지를 표시합니다.
