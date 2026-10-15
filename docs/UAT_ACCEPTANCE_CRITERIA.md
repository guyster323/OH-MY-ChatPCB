# UAT Acceptance Criteria - Panel Improvements

Based on UAT report dated 2026-10-15 KST

## 1. Rollback Button (High Priority)

### Acceptance
- [ ] Rollback 버튼이 Transaction 다이얼로그에 표시됨
- [ ] 버튼 클릭 시 "Rollback은 마지막 transaction을 되돌립니다" 확인 대화상자 표시
- [ ] 확인 시 `project.transaction.rollback` WebSocket API 호출
- [ ] 마지막 transaction이 없을 때 버튼이 disabled 상태
- [ ] disabled 상태일 때 tooltip으로 "No transactions available" 또는 "No transactions to rollback" 표시
- [ ] accessible name이 "Rollback last transaction"으로 설정됨
- [ ] rollback 성공 시 request status에 "Transaction rolled back successfully." 표시
- [ ] rollback 후 project inspection 자동 refresh

### Test
```javascript
// Transaction dialog에서 rollback 버튼 확인
const rollbackButton = document.querySelector('#rollback-button');
assert(rollbackButton.getAttribute('aria-label') === 'Rollback last transaction');

// Transaction이 없을 때 disabled
assert(rollbackButton.disabled === true);

// Transaction 후 rollback 가능
// (transaction 생성 후)
assert(rollbackButton.disabled === false);
rollbackButton.click();
// confirm 대화상자 확인 및 승인
// rollback 성공 메시지 확인
```

## 2. Stop Button (High Priority)

### Acceptance
- [ ] Stop 버튼이 request status 근처에 표시됨
- [ ] 요청이 진행 중일 때만 활성화
- [ ] 버튼 클릭 시 `provider.cancel` WebSocket API 호출 (invocationId 사용)
- [ ] 요청이 없을 때 버튼이 disabled 상태
- [ ] disabled 상태일 때 tooltip으로 "No active request" 또는 "Request ID not available" 표시
- [ ] accessible name이 "Stop request"로 설정됨
- [ ] stop 성공 시 progress에 "Stopping request..." 표시
- [ ] stop 후 request status가 ready 또는 idle로 전환

### Test
```javascript
// Stop 버튼 확인
const stopButton = document.querySelector('#stop-request-button');
assert(stopButton.getAttribute('aria-label') === 'Stop request');

// 요청이 없을 때 disabled
assert(stopButton.disabled === true);

// 요청 진행 중일 때 enabled
// (Send 후)
assert(stopButton.disabled === false);
stopButton.click();
// "Stopping request..." 메시지 확인
```

## 3. ERC Results in Preview (High Priority)

### Acceptance
- [ ] Patch approval 카드에 ERC 미리보기 섹션 표시
- [ ] ERC 오류/경고 개수가 "ERC: X errors, Y warnings" 형식으로 표시
- [ ] ERC 오류가 있을 때 경고 메시지 "⚠️ ERC 오류가 있습니다. 적용 시 검증 실패로 거부될 수 있습니다." 표시
- [ ] 주요 이슈 top 3이 표시됨 (예: "label_dangling (17), ...")
- [ ] ESP32-S3 gas sensor 예제에서 ERC 17 errors / 162 warnings가 미리보기에 표시됨
- [ ] 사용자가 apply 버튼을 누르기 전에 ERC 실패 가능성을 알 수 있음

### Test
```javascript
// Patch preview 후 ERC 미리보기 확인
const ercPreview = document.querySelector('#patch-preview-erc');
assert(ercPreview.hidden === false);

const ercSummary = document.querySelector('#patch-preview-erc-summary');
assert(ercSummary.textContent.includes('ERC:'));
assert(ercSummary.textContent.includes('errors'));
assert(ercSummary.textContent.includes('warnings'));

// 오류가 있을 때 경고 표시
if (errorCount > 0) {
  const ercWarning = document.querySelector('#patch-preview-erc-warning');
  assert(ercWarning.hidden === false);
  assert(ercWarning.textContent.includes('ERC 오류가 있습니다'));
}
```

## 4. Provider Discovery Hints (Medium Priority)

### Acceptance
- [ ] Provider status에 CLI가 missing일 때 설치/로그인 힌트 표시
- [ ] Codex: "Install: npm install -g @openai/codex, then: codex login --device-auth" 힌트
- [ ] Claude: "Install: npm install -g claude-code ... then: claude login" 힌트
- [ ] Copilot: "Install: gh extension install github/gh-copilot" 힌트
- [ ] PATH 관련 안내 포함 ("Add ~/.local/bin or global npm bin to PATH if needed")
- [ ] Provider status에 hover 시 tooltip으로 힌트 표시
- [ ] `provider.status` API response에 `hint` 필드 포함

### Test
```javascript
// Provider missing일 때 hint 확인
const providerStatus = await checkProviderAvailability({
  provider: 'codex',
  commandExistsImpl: async () => false
});
assert(providerStatus.status === 'missing');
assert(providerStatus.hint);
assert(providerStatus.hint.includes('npm install'));
```

## 5. README Provider Setup Section (Medium Priority)

### Acceptance
- [ ] README에 "Provider setup" 섹션 추가
- [ ] Codex CLI 설치 및 인증 단계 포함
  - [ ] npm install 명령
  - [ ] PATH 설정 안내
  - [ ] `codex login --device-auth` 명령
  - [ ] `codex login status` 검증 명령
  - [ ] Troubleshooting 섹션
- [ ] Claude Code CLI 설치 및 인증 단계 포함
  - [ ] 공식 문서 링크
  - [ ] 설치 명령
  - [ ] `claude login` 명령
  - [ ] Troubleshooting 섹션
- [ ] GitHub Copilot CLI 설치 및 인증 단계 포함
  - [ ] GitHub CLI 설치 (winget/brew/apt)
  - [ ] `gh extension install github/gh-copilot` 명령
  - [ ] `gh auth login` 명령
  - [ ] Copilot 구독 요구사항
  - [ ] Troubleshooting 섹션
- [ ] Provider status 패널 사용 방법 설명 (available/missing 상태)

## 6. Testing

### Acceptance
- [ ] Provider registry 테스트에 hint 검증 추가
- [ ] Panel UI에서 rollback/stop 버튼 접근성 테스트
- [ ] ERC 미리보기 렌더링 테스트
- [ ] 모든 기존 테스트 통과 (실패하는 기존 테스트 제외)

## 7. User-Facing String Grouping

### Acceptance
- [ ] 새로운 UI 문자열이 최소화되고 그룹화됨
- [ ] 한국어/영어 혼용 최소화
- [ ] 향후 en/ko locale 파일로 이동 가능한 구조

### Localization-Ready Strings
- Rollback confirmation: "Rollback은 마지막 transaction을 되돌립니다. 계속하시겠습니까?"
- Rollback success: "Transaction rolled back successfully."
- Stop progress: "Stopping request..."
- ERC preview title: "ERC 미리보기"
- ERC warning: "⚠️ ERC 오류가 있습니다. 적용 시 검증 실패로 거부될 수 있습니다."
- ERC summary format: "ERC: X errors, Y warnings"
- Provider hints (English only, technical documentation)

## Git Rules Compliance

### Acceptance
- [ ] 모든 변경사항이 `cursor/uat-panel-improvements-a882` 브랜치에 commit
- [ ] main 브랜치로 push하지 않음
- [ ] force push 사용하지 않음
- [ ] merge 수행하지 않음
- [ ] 각 논리적 변경사항마다 별도 commit
- [ ] PR은 draft 상태로 생성

## Definition of Done

✅ 모든 acceptance criteria 충족
✅ 테스트 추가 및 통과
✅ README 업데이트
✅ 커밋 메시지 명확
✅ Draft PR 생성
✅ PR 설명이 한국어로 작성됨 (what/why/tests 포함)
