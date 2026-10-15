# ChatPCB Architecture

## 개요

OH-MY-ChatPCB는 로컬 우선(local-first), 증거 기반(evidence-gated) KiCad 에이전트 런타임으로, 사용자 소유 AI 제공자를 네이티브 KiCad 워크플로에 연결합니다.

The product UI is the KiCad schematic editor's right-side ChatPCB panel, not a standalone web application.

## 3계층 구조

```
┌─────────────────────────────────────┐
│  KiCad Fork (C++ wxWebView Panel)  │  ← 사용자 인터페이스
├─────────────────────────────────────┤
│  Agent Daemon (127.0.0.1:41317)    │  ← WebSocket/HTTP 브리지
├─────────────────────────────────────┤
│  KiCad Automation (kicad-cli)      │  ← 생성, 검증, SPICE
└─────────────────────────────────────┘
```

**모든 컴포넌트는 로컬에서만 실행됩니다. 외부 서버 없음.**

## 데이터 흐름

### 1. 프로젝트 생성
```
Panel → daemon: project.create { workspaceRoot, projectName }
       ← daemon: { projectDir: "/safe/path/my-project" }
```

### 2. 회로 요청
```
Panel → KiCad Host: project.status (dirty check)
      ← Host: { linkState: "ready" | "conflict" }

Panel → daemon: project.request { projectDir, prompt, provider }
       ← daemon: { operation, files, validation, review }

Panel → Host: project.reload (if ready)
```

### 3. 패치 승인
```
daemon: schematic.patch (preview)
       → { diff, beforeHash, afterHash, approval }

Panel: user clicks "Apply"
      → daemon: schematic.patch { approved: true }
         daemon: atomic write + verify + rollback on mismatch
```

## 핵심 원칙

### Evidence-Gated
- 모든 변경사항은 미리보기 필수
- artifact-bound approval (단일 사용, 만료, 해시 검증)
- 롤백 보장 (전/후 스냅샷)

### Deterministic Inspection
- `project.inspect`: 저장된 KiCad 파일의 해시와 구조 추출
- 빌트인 analyzer: 회로도 (components, nets, labels), PCB (footprints, pads, traces)
- 외부 analyzer: 샌드박스 필요 (현재 비활성)

### Validation Gates
1. **ERC** (Electrical Rules Check): 회로도 전기 규칙 검증
2. **DRC** (Design Rules Check): PCB 설계 규칙 검증 + 미연결 확인
3. **Readiness Review**: 부품, 소싱, 데이터시트, 시뮬레이션, 레이아웃 증거 종합

**중요**: ERC 0/0 ≠ 제조 준비 완료. DRC + readiness + 인간 승인 필요.

## 주요 컴포넌트

### Panel UI (`apps/panel/`)
- 바닐라 JavaScript WebView 번들
- KiCad fork의 wxWebView에 로드됨
- Circuit / Layout / 제품화 워크플로 보드
- WebSocket 연결로 daemon과 통신

### Runtime (`src/runtime/`)
- `agent-daemon.js`: HTTP/WS 서버 (127.0.0.1:41317), 도구 호출 디스패처, 경로 가드 (home/system 거부), provider 브리지 (Codex, Claude Code, Copilot CLI)
- `provider-process.js`: 로컬 AI CLI 프로세스 실행과 출력 정화
- `provider-registry.js`: provider 정의, 가용성, 프롬프트 구성
- `board-profiles.js`: 지원 보드 프로필 (ESP32-S3, STM32 등)
- `circuit-spec.js`: 자연어 프롬프트를 CircuitSpec으로 정규화
- `envelope.js`: WebSocket envelope 생성과 검증
- `part-sourcing.js`: 부품 검색과 소싱 요약
- `patch-approval-registry.js`: 만료되는 단일 사용 패치 승인
- `product-catalog.js`: 제품 요청 감지와 인터뷰 초안
- `project-mutex-registry.js`: 프로젝트별 트랜잭션 잠금
- `request-conversation.js`: 회로 요청 대화 상태
- `transaction-journal.js`: 프로젝트 트랜잭션 저널 저장

### Workflow (`src/workflow/`)
- `generate-mcu-project.js`: MCU 주변장치 회로도/PCB 생성
- `project-transaction.js`: 트랜잭션 적용과 롤백
- `schematic-patch.js`: 승인 게이트, diff, apply
- `validate-project.js`: ERC 파싱과 상태 보고
- `validate-board.js`: DRC 파싱과 미연결 항목 추출
- `inspect-project.js`: artifact 인벤토리와 다이제스트
- `inspection-copy.js`: 심볼릭 링크를 거부하고 검사 트리를 복사
- `native-proposal-source.js`: 회로 사양으로 프로젝트 산출물을 다시 생성하는 제안
- `project-workspace.js`: 프로젝트 디렉터리 생성과 경로 가드
- `review-project.js`: 회로 readiness 리뷰
- `simulate-project.js`: `.cir` 픽스처를 `ngspice -b`로 실행

### Analyzer (`src/analyzer/`)
- `sexpr.js`: S-expression 파서
- `kicad-schematic.js`: 회로도 구조 사실 추출 (deterministic)
- `kicad-pcb.js`: PCB 구조 사실 추출 (deterministic)
- `project-analyzer.js`: analyzer 오케스트레이션
- `external-adapter.js`: 외부 analyzer. 샌드박스 런처가 없어 실행은 skip (`ANALYZER_SANDBOX_UNAVAILABLE`)
- `fact-contract.js`: fact/finding 정규화와 confidence 계약
- confidence 라벨: `deterministic`, `heuristic`, `datasheet-backed`

### Selection context (`src/context/`)
- `selection-context.js`: KiCad 편집기 선택 항목 정규화와 선택 증거

### Evidence (`src/evidence/`)
- `evidence-manifest.js`: artifact-bound 증거 매니페스트
- `artifact-inventory.js`: 저장된 파일 해싱과 인벤토리
- `transaction-inventory.js`: 트랜잭션 기록

### KiCad Integration (`src/kicad/`)
- `kicad-cli.js`: KiCad CLI 경로 탐색과 wrapper
- `project-generator.js`: 심볼, 풋프린트, 넷, 트레이스 생성
- `board-route-planner.js`: 보수적 라우팅 알고리즘
- `pad-geometry.js`: 패드 지오메트리 계산

## 메시지 프로토콜

모든 panel/daemon 메시지는 동일한 envelope 사용:

```json
{
  "version": 1,
  "id": "evt_<uuid>",
  "type": "tool.call",
  "createdAt": "2026-10-15T00:00:00.000Z",
  "payload": { /* tool-specific */ }
}
```

**지원되는 타입**:
- `chat.message`
- `agent.delta`
- `tool.call`
- `tool.result`
- `system.status`

## 생성 계약

### 출력 파일
- `.kicad_pro`, `.kicad_sch`, `.kicad_pcb`
- `chatpcb.kicad_sym` (프로젝트 로컬 심볼 라이브러리)
- `sym-lib-table`
- `.chatpcb.json` (intent/evidence manifest, schema v2)
- `_simulation.cir` (SPICE)

### 규칙
- **KiCad files are the authoritative editable state**
- `.chatpcb.json` is an intent/evidence manifest, not a replacement for KiCad files
- 커스텀 `chatpcb_*` 최상위 노드 금지
- Schema v1 manifests remain readable but unverified (`legacy-unverified`)
- Schema v2 is artifact-bound with canonical `constraints`, `artifacts`, `toolchain`, `facts`, `findings`, `approvals`, `releaseGates`
- Rollback covers KiCad files (`.kicad_sch`, `.kicad_pcb`, `.kicad_pro`, `.kicad_dru`), `.chatpcb.json`, libraries (`.kicad_sym`, `.kicad_mod`, `sym-lib-table`, `fp-lib-table`), and SPICE fixtures (`.cir`)

## 보안 경계

### Provider Isolation
- API 키 저장 안 함
- 로컬 CLI만 호출 (Codex, Claude Code, Copilot)
- stderr 시크릿 리다렉션
- `AbortSignal` 기반 프로세스 취소

### Path Guards
- 프로젝트 경로에서 심볼릭 링크 거부
- workspace root 격리 옵션
- home/system 디렉토리 생성 거부
- canonical path 검증

### KiCad CLI Validation
- daemon은 request의 `kicadCliPath` 무시
- 서버 설정 또는 `KICAD_CLI_PATH` 환경변수만 신뢰
- PATH 검색: 절대 경로만, 프로세스 cwd와 프로젝트 트리 제외
- 임시 복사본은 canonicalize 후 검증

### Analyzer Sandbox
- 외부 analyzer 실행 현재 **비활성**
- `ANALYZER_SANDBOX_UNAVAILABLE` 반환
- 재활성화 조건: 완전한 페이로드 무결성 + 파일시스템 격리

## 검증 순서

1. **KiCad CLI 탐색**
   - 명시적 플래그
   - `KICAD_CLI_PATH` 환경변수
   - Windows 설치 디렉토리 (10 → 9 → 8 → 7)
   - PATH의 절대 경로 (cwd와 프로젝트 제외)

2. **ERC/DRC 실행**
   - 검증용 disposable 복사본 생성
   - `kicad-cli sch erc --format json`
   - `kicad-cli pcb drc --refill-zones --format json`
   - KiCad CLI 없으면 `skipped: true` 반환

3. **Readiness Review**
   - ERC + 부품 소싱 + 데이터시트 + 시뮬레이션 + 레이아웃 증거
   - ERC 통과 ≠ release ready
   - DRC unconnected 카운트 포함

## 파일 구조

```
OH-MY-ChatPCB/
├── bin/
│   └── chatpcb-cli.js                 # CLI 진입점
├── src/
│   ├── analyzer/
│   │   ├── external-adapter.js        # 외부 analyzer (skip)
│   │   ├── fact-contract.js           # fact/finding 계약
│   │   ├── kicad-pcb.js               # PCB 사실 추출
│   │   ├── kicad-schematic.js         # 회로도 사실 추출
│   │   ├── project-analyzer.js        # analyzer 오케스트레이션
│   │   └── sexpr.js                   # S-expr 파서
│   ├── context/
│   │   └── selection-context.js       # 편집기 선택 컨텍스트
│   ├── evidence/
│   │   ├── artifact-inventory.js      # 파일 해싱
│   │   ├── evidence-manifest.js       # artifact-bound 증거
│   │   └── transaction-inventory.js   # 트랜잭션 기록
│   ├── kicad/
│   │   ├── board-route-planner.js     # 라우팅 알고리즘
│   │   ├── kicad-cli.js               # KiCad CLI wrapper
│   │   ├── pad-geometry.js            # 패드 지오메트리
│   │   └── project-generator.js       # 심볼/풋프린트 생성
│   ├── runtime/
│   │   ├── agent-daemon.js            # WebSocket/HTTP 서버
│   │   ├── board-profiles.js          # 지원 보드 프로필
│   │   ├── circuit-spec.js            # 프롬프트 → CircuitSpec
│   │   ├── envelope.js                # WebSocket envelope
│   │   ├── part-sourcing.js           # 부품 소싱
│   │   ├── patch-approval-registry.js # 패치 승인 토큰
│   │   ├── product-catalog.js         # 제품 요청 카탈로그
│   │   ├── project-mutex-registry.js  # 프로젝트 잠금
│   │   ├── provider-process.js        # AI CLI 프로세스 브리지
│   │   ├── provider-registry.js       # provider 탐색과 상태
│   │   ├── request-conversation.js    # 회로 요청 대화
│   │   └── transaction-journal.js     # 트랜잭션 저널
│   └── workflow/
│       ├── generate-mcu-project.js    # 회로도/PCB 생성
│       ├── inspect-project.js         # artifact 인벤토리
│       ├── inspection-copy.js         # 검사 트리 복사
│       ├── native-proposal-source.js  # 네이티브 재생성 제안
│       ├── project-transaction.js     # 적용과 롤백
│       ├── project-workspace.js       # 프로젝트 경로 가드
│       ├── review-project.js          # readiness 리뷰
│       ├── schematic-patch.js         # 패치 승인 게이트
│       ├── simulate-project.js        # ngspice 배치 실행
│       ├── validate-board.js          # DRC 검증
│       └── validate-project.js        # ERC 검증
├── apps/panel/                         # WebView UI
├── kicad-fork/chatpcb_panel/          # C++ wxWebView 호스트
└── tests/                              # 344 테스트 (42 파일)
```

## 다음 단계

현재 아키텍처 부채:
- `agent-daemon.js` 971줄 (서버 + 디스패처 + 이벤트 혼재)
- `project-generator.js` 1874줄 (MCU + DCDC + BMS + lib + SPICE 혼재)
- 포트 41317이 7개 파일에 하드코딩
- 프로토콜 메시지 타입이 중복 정의

리팩토링 계획은 `ROADMAP.md` 참조.

---

**자세한 설계 문서와 계획은 `docs/archive/`에 보관되어 있습니다.**
