# OH-MY-ChatPCB Roadmap

OH-MY-ChatPCB는 evidence-gated KiCad agent runtime입니다.

## Product Goal

KiCad 회로도 편집기 오른쪽에 **ChatPCB 채팅 패널**을 통합하여, 사용자가 한국어나 영어로 "ESP32-S3 센서 보드 만들어줘"처럼 요청하면 로컬 AI CLI(Codex, Claude Code, Copilot)가 KiCad 프로젝트(회로도와 PCB)를 만들거나 수정합니다. 모든 변경사항은 **미리보기 → 사용자 승인 → 적용 → ERC/DRC 검증 → 필요시 롤백** 순서를 거칩니다.

핵심 원칙: "증거 없이 출시 준비 완료라고 말하지 않는다" (evidence-gated)

최종 목표: 제조까지 가능한 보드 (Gerber, BOM, DRC 0/0, 미연결 0)

## Current State

### 기술 스택
- 순수 JS (ESM), Node ≥20
- 런타임 의존성 없음, devDep은 Playwright만
- KiCad 포크용 C++ 패널 (wxWebView)
- PowerShell 스크립트 (Windows 전용)
- 테스트: `node --test`, 41개 파일, 340개 테스트

### 구조
- `bin/chatpcb-cli.js` → `src/workflow/*` (생성, 검증, 패치, 트랜잭션)
- `src/runtime/agent-daemon.js` (HTTP/WS 서버, 포트 41317)
- `src/runtime/provider-*` (AI CLI 연결)
- `src/analyzer/*` (S-expression 파서, 사실 추출)
- `src/evidence/*` (해시, 증거 매니페스트)
- `src/kicad/*` (생성기, 라우팅)
- `apps/panel` (바닐라 JS UI, 1123줄)

### 동작하는 것
- ESP32-S3, STM32 프로필 회로도 생성 (ERC 0/0)
- 승인 기반 패치와 롤백
- 트랜잭션 저널
- project.inspect
- provider 호출과 취소
- 패널 워크플로 UI

### 반쯤 된 것
- PCB 라우팅 (DRC 위반 0, 하지만 미연결: ESP32 24개, STM32 22개)
- 일반 프롬프트용 심볼
- Gerber/BOM 내보내기
- 설치 패키지
- SPICE 모델
- 실시간 부품 소싱
- 외부 analyzer (샌드박스 없어 비활성)

### 활동 이력
- 6월: 23 커밋
- 8월: 30 커밋  
- 9월: 58 커밋
- 9/22 이후: **약 3주 동안 커밋 없음**
- 9월 작업은 안전장치 (보안, 증거, 트랜잭션)에 집중
- PCB 완성 진척: 9/4 측정 이후 정체
- 미연결 수치: PR #1 (9/3)부터 그대로
- `route-reset-boot` 실험: "머지 보류" 상태로 멈춤

### 핵심 문제

**버그 (Linux, Node 20.19.2 재현)**
- `npm test`: 340개 중 325 통과, **13 실패**, 2 skip
- `WebSocket is not defined` (3건+): Node 20에서 전역 WebSocket 미지원, engines는 `>=20` 선언
- 프로필/생성기 테스트 실패 (4, 5, 205~209): Windows 라이브러리 경로 의존, `Device:R`, `ESP32-S3-WROOM-1` 누락
- 트랜잭션 승인/롤백 테스트 실패 (61, 64)

**구조 부채**
- CI 없음 (`.github` 없음)
- 거대 파일: `project-generator.js` 1874줄, `agent-daemon.js` 971줄, `daemon.test.js` 2086줄
- 프로토콜 메시지 타입이 panel.js와 데몬 양쪽에 문자열 리터럴로 중복
- 포트 41317이 6개 파일에 하드코딩
- CORS가 포트 없이 `http://127.0.0.1`로 고정
- 경로 탐색 방지 가드가 5곳에 중복

**방향 문제**
- 안전/증거 인프라는 탄탄하지만 **사용자에게 보이는 결과물 (완성된 PCB) 정체**
- 진척 지표 (미연결 수, 테스트 통과율)가 CI에 없고 핸드오프 문서에만 기록
- 셀프 머지만 있고 리뷰 없음
- 오래된 브랜치 4개 정리 안 됨

## Prioritized Roadmap

### P0: 녹색 기준선 회복

**목표**: 테스트 통과율 100%, CI 녹색, 환경 독립적 빌드

1. **Node 버전 정리**
   - `engines`를 `>=22`로 올리거나 `ws` 패키지 추가
   - `.nvmrc` 추가
   - 수용 기준: Node 22에서 WS 테스트 통과

2. **환경 의존 테스트 분리**
   - KiCad 라이브러리 필요 테스트를 fixture로 변경
   - 환경 없으면 typed skip (`KICAD_LIB_UNAVAILABLE`)
   - 61, 64번 롤백 실패 원인 분석 후 수정
   - 수용 기준: 클린 Linux에서 전체 테스트 통과

3. **GitHub Actions CI**
   - ubuntu와 windows에서 Node 22로 `npm test` 실행
   - ESLint 최소 규칙 추가
   - main 머지 조건: CI 녹색
   - 수용 기준: 모든 PR이 CI 통과 후 머지 가능

4. **상수 단일화**
   - 포트, 프로토콜 메시지 타입, 경로 가드를 `src/shared/`로 통합
   - 경로와 프로토콜 계약 테스트 추가
   - CORS에 포트 포함하도록 수정
   - 수용 기준: 하드코딩된 상수 제거, 계약 테스트 통과

### P1: 방향 재설정과 핵심 가치 진척

**목표**: ESP32-S3 프로필 미연결 0, DRC 0, Gerber/BOM 출력

5. **PCB 미연결 수치 CI 추적**
   - 회귀 테스트로 "24 이하" 검증
   - 수용 기준: CI가 미연결 증가 감지

6. **라우팅 미연결 해소**
   - 넷 그룹 단위로 PR 분할
   - route-reset-boot 브랜치 채택/폐기 결정
   - 수용 기준: ESP32-S3 프로필 미연결 0

7. **타입 체크와 죽은 코드 정리**
   - `// @ts-check`와 JSDoc 추가
   - knip으로 죽은 코드 제거
   - 커버리지와 Prettier 도입
   - 수용 기준: 타입 에러 0, 커버리지 80%+

8. **동기 패턴 개선**
   - sleep 기반 검증을 이벤트 대기로 전환
   - 재연결에 지수 백오프 적용
   - 수용 기준: 타임아웃 기반 테스트 제거

### Electrical verification (EEBench) — 계획

[EEBench](https://eebench.org/)는 회로도/프로필 초안과 제조 출력 사이의 아날로그/전원 품질 기준입니다. 현재 ChatPCB는 EEBench 리더보드 실행이 아닙니다: V1은 atopile `.ato` + SPICE를 평가하며, KiCad artifacts는 평가하지 않습니다.

EEBench를 요구사항 → 설계 → 시뮬레이션 루프의 내부 품질 기준으로 사용하는 것을 계획 중입니다:
- **계획**: SPICE 기반 요구사항 검증 (gain, hold-up, ripple, thresholds, tolerance corners) — 현재는 `ngspice -b` exit code만 확인
- **계획**: 데이터시트 기반 부품 모델과 비용 (회로가 작동한 후에만 비용 크레딧) — 현재 미구현
- **현재**: `ngspice` 사용 불가 시 typed skip 반환 (현재 skip은 `ok: true`로 통과 처리되는 알려진 갭)
- **계획**: Gerber/drill/BOM 제조 출력 전 이 게이트 정의 필요

### P2: 구조 분리와 제품화

**목표**: 모듈화, 크로스플랫폼, 설치 패키지

9. **daemon 모듈 분리**
   - `agent-daemon.js`를 서버, 핸들러, 이벤트 모듈로 분할
   - `daemon.test.js`도 함께 분할
   - 수용 기준: 각 파일 500줄 이하

10. **generator 모듈 분리**
    - `project-generator.js`를 서브회로별 모듈로 분할 (MCU, DCDC, BMS, lib, SPICE)
    - product-catalog 데이터를 JSON으로 분리
    - 수용 기준: 각 파일 500줄 이하

11. **상태 enum 정리**
    - Gerber, drill, BOM 내보내기를 typed 상태 enum으로 전환
    - 문자열 상태 (예: 'Gerbers pending') 제거
    - 수용 기준: 타입 안전 상태 관리

12. **크로스플랫폼과 패키지**
    - PowerShell 스크립트를 Node 스크립트로 이식
    - kicad-fork 패치 적용 검사를 CI에 추가
    - 설치 패키지 생성
    - 수용 기준: macOS, Linux에서 실행 가능

## 즉시 시작할 첫 3개 PR

1. **Node 22 엔진 수정과 CI 워크플로**
2. **환경 의존 테스트를 skip/fixture로 정리**
3. **공유 상수와 프로토콜 모듈**

모두 브랜치와 PR로 올리며, main에 직접 푸시하지 않습니다.

---

**이전 계획과 세션 핸드오프 문서는 `docs/archive/`로 이동되었습니다.**
