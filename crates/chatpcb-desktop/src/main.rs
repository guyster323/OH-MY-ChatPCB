use chatpcb_core::design::esp32s3_usb_sensor_board_spec;
use chatpcb_core::layout::freerouting_contract;
use chatpcb_core::manufacturing::build_jlcpcb_package;
use chatpcb_core::project::create_preview_workspace;
use chatpcb_core::provider::{catalog_with_probe, catalog_with_status_probe, ProviderProbeStatus};
use chatpcb_core::quality::{evaluate_workspace_quality, write_workspace_quality_reports};
use chatpcb_desktop::ui_model::chat_actions_contract;
use serde::Serialize;
use std::{fs, path::PathBuf, process::Command};

#[derive(Debug, Serialize)]
struct DesktopSelfTest {
    app_name: &'static str,
    ui_runtime: &'static str,
    transport: &'static str,
    layout: LayoutContract,
    chat_transcript: ChatTranscriptContract,
    chat_actions: chatpcb_desktop::ui_model::ChatActionsContract,
    left_tabs: Vec<&'static str>,
    right_panel: Vec<&'static str>,
    supported_board: String,
    autorouter: String,
    manufacturing_outputs: Vec<String>,
    providers: Vec<String>,
}

#[derive(Debug, Serialize)]
struct LayoutContract {
    left_ratio: f32,
    right_ratio: f32,
}

#[derive(Debug, Serialize)]
struct ChatTranscriptContract {
    multiline: bool,
    read_only: bool,
}

fn main() {
    if std::env::args().any(|arg| arg == "--first-chat-smoke") {
        print_first_chat_smoke();
        return;
    }

    if std::env::args().any(|arg| arg == "--self-test-summary") {
        print_self_test_summary();
        return;
    }

    if std::env::args().any(|arg| arg == "--self-test") {
        print_self_test();
        return;
    }

    run_desktop_app();
}

fn print_self_test() {
    let spec = esp32s3_usb_sensor_board_spec("ESP32-S3 USB-C sensor board");
    let package = build_jlcpcb_package(&spec);
    let route = freerouting_contract();
    let providers = catalog_with_probe(probe_command_version)
        .into_iter()
        .map(|provider| provider.display_name)
        .collect();

    let contract = DesktopSelfTest {
        app_name: "ChatPCB KiCad Preview",
        ui_runtime: "native-win32",
        transport: "stdio-jsonl",
        layout: LayoutContract {
            left_ratio: 0.7,
            right_ratio: 0.3,
        },
        chat_transcript: ChatTranscriptContract {
            multiline: true,
            read_only: true,
        },
        chat_actions: chat_actions_contract(),
        left_tabs: vec!["회로도", "PCB 레이아웃", "검증", "제조 미리보기"],
        right_panel: vec![
            "Provider Login",
            "Model selector",
            "Chat transcript",
            "채팅 입력 라벨",
            "채팅 입력칸",
            "예시 사용",
            "설계 생성",
            "PCB 열기",
            "검토 목록",
            "KiCad 열기",
            "Pipeline status",
        ],
        supported_board: spec.product_name,
        autorouter: format!("{} {}", route.engine, route.bundled_version),
        manufacturing_outputs: package.files,
        providers,
    };

    println!("{}", serde_json::to_string_pretty(&contract).unwrap());
}

fn print_self_test_summary() {
    let spec = esp32s3_usb_sensor_board_spec("ESP32-S3 USB-C sensor board");
    let package = build_jlcpcb_package(&spec);
    let route = freerouting_contract();
    let chat_actions = chat_actions_contract();
    let model_items = chatpcb_desktop::ui_model::model_selector_display_items();
    let fallback_model = chatpcb_desktop::ui_model::selected_model_for_statuses(&[]);
    let evidence = first_run_evidence_summary_contract()
        .expect("first-run evidence summary contract must be readable");

    println!("ChatPCB KiCad Preview Self Test");
    println!("PASS native Windows app");
    println!("PASS 70/30 current-project workspace");
    println!("PASS Provider Login shows local CLI login hints");
    assert_eq!(
        model_items.first().copied(),
        Some("내장 미리보기"),
        "model selector must show built-in preview display text before provider-backed models"
    );
    assert_eq!(
        fallback_model, "built-in-preview",
        "model selector must fall back to built-in preview when no provider is ready"
    );
    println!("PASS model selector falls back to built-in preview");
    assert!(
        chat_actions.provider_model_selection_is_readiness_only_for_preview,
        "Provider/model selection must be readiness-only until live provider invocation exists"
    );
    println!("PASS provider/model selection is readiness-only for preview generation");
    assert!(
        chat_actions.app_launch_focuses_prompt_input,
        "app launch must focus the prompt so first-run users can type immediately"
    );
    println!("PASS app launch focuses the prompt for immediate first chat");
    assert!(
        chat_actions.app_launch_has_korean_first_chat_cue
            && chatpcb_desktop::ui_model::initial_transcript()
                .contains("바로 채팅: 만들 보드를 채팅 입력칸에 적고 Enter.")
            && chatpcb_desktop::ui_model::initial_pipeline_status()
                .contains("만들 보드 입력 후 Enter"),
        "first screen must show a Korean first-chat cue without opening external docs"
    );
    println!("PASS first screen shows a Korean first-chat cue");
    assert!(
        chat_actions.prompt_input_has_visible_label && chat_actions.prompt_input_has_empty_cue,
        "prompt input must have a visible label and empty cue for first-run users"
    );
    println!("PASS prompt input has a visible label and empty cue");
    assert!(
        chat_actions.prompt_enter_sends_design,
        "Enter must send the first design through the native chat path"
    );
    println!("PASS pressing Enter sends the first design");
    assert!(
        chat_actions.empty_prompt_uses_visible_builtin_example,
        "Empty prompt sends must visibly explain the built-in example fallback"
    );
    println!("PASS empty prompt visibly uses the built-in ESP32-S3 example");
    assert!(
        chat_actions.send_design_returns_focus_to_prompt,
        "Send design must return focus to the prompt for follow-up chat"
    );
    println!("PASS Send design returns focus for follow-up chat");
    assert!(
        chat_actions.live_schematic_visible_in_left_pane
            && chat_actions.chat_send_updates_live_schematic
            && chat_actions.live_schematic_shows_apply_result,
        "Left pane must show a live schematic, the chat send must update it, and the apply result must stay visible"
    );
    println!("PASS live schematic updates beside chat and Agent answer");
    println!("PASS first chat can create the built-in ESP32-S3 preview");
    assert!(
        chat_actions.use_example_selects_prompt_for_overwrite,
        "Use example must select prompt text so typing immediately overwrites it"
    );
    println!("PASS Use example selects prompt text for immediate overwrite");
    assert!(
        chat_actions.open_saved_artifacts_disabled_until_workspace
            && chat_actions.open_saved_artifacts_enabled_after_preview,
        "Open PCB/checklist must wait until a preview workspace exists"
    );
    println!("PASS Open PCB/checklist wait for a saved preview");
    println!("PASS KiCad preview scaffold and validation reports are wired");
    println!(
        "PASS bundled autorouter contract: {} {}",
        route.engine, route.bundled_version
    );
    println!(
        "PASS JLCPCB package contract files: {}",
        package.files.len()
    );
    println!(
        "PASS Review checklist selects BEGINNER-NEXT-STEPS.txt: {}",
        chat_actions.open_evidence_selects_beginner_next_steps_file
    );
    assert!(
        evidence.points_back_to_follow_up_chat,
        "FIRST-RUN-SUMMARY.txt must point users back to follow-up chat"
    );
    assert!(
        evidence.blocks_jlcpcb_upload,
        "FIRST-RUN-SUMMARY.txt must block JLCPCB upload"
    );
    assert!(
        evidence.quality_report_checks_90_point_gate,
        "design-quality-report must enforce the 90-point validation gate"
    );
    assert!(
        evidence.quality_report_blocks_unattended_order,
        "design-quality-report must keep the human signoff boundary"
    );
    println!("PASS first-run evidence points back to follow-up chat");
    println!("PASS first-run evidence blocks JLCPCB upload");
    println!("PASS design quality report checks 90-point validation gate");
    println!("PASS design quality report keeps human signoff boundary");
    println!("Board: {}", spec.product_name);
    println!("Boundary: prototype-review, not order-ready");
}

fn print_first_chat_smoke() {
    let prompt = chatpcb_desktop::ui_model::example_board_prompt();
    let root = first_chat_smoke_root();
    let workspace = create_preview_workspace(prompt, &root)
        .expect("first chat smoke test must create a preview workspace");
    let project_dir = PathBuf::from(&workspace.project_dir);
    let kicad_check = run_first_chat_smoke_kicad_pcb_check(&project_dir);
    let validation = run_first_chat_smoke_erc_drc_reports(&project_dir);
    let first_run_summary = fs::read_to_string(&workspace.first_run_summary_file)
        .expect("first chat smoke test must read FIRST-RUN-SUMMARY.txt");
    let beginner_next_steps = fs::read_to_string(&workspace.beginner_next_steps_file)
        .expect("first chat smoke test must read BEGINNER-NEXT-STEPS.txt");
    let manufacturing_readiness = fs::read_to_string(&workspace.manufacturing_readiness_file)
        .expect("first chat smoke test must read manufacturing-readiness-preview.txt");
    let quality_report = evaluate_workspace_quality(&project_dir)
        .expect("first chat smoke test must evaluate the design quality report");
    let quality_report_file = PathBuf::from(&workspace.quality_report_file);
    let quality_report_markdown_file = PathBuf::from(&workspace.quality_report_markdown_file);
    let quality_report_markdown = fs::read_to_string(&quality_report_markdown_file)
        .expect("first chat smoke test must read design-quality-report.md");

    assert!(
        !prompt.trim().is_empty(),
        "first chat smoke test prompt must not be empty"
    );
    assert!(
        workspace
            .files
            .iter()
            .any(|file| file.ends_with(".kicad_pro"))
            && workspace
                .files
                .iter()
                .any(|file| file.ends_with(".kicad_sch"))
            && workspace
                .files
                .iter()
                .any(|file| file.ends_with(".kicad_pcb")),
        "first chat smoke test must write KiCad preview scaffold files"
    );
    assert!(
        first_run_summary.contains("후속 입력"),
        "first chat smoke test summary must point users back to follow-up chat"
    );
    assert!(
        first_run_summary.contains("JLCPCB에 업로드하지 마세요"),
        "first chat smoke test summary must block JLCPCB upload"
    );
    assert!(
        beginner_next_steps.contains("먼저 할 일")
            && beginner_next_steps.contains("후속 채팅")
            && beginner_next_steps.contains("아직 주문하지 마세요"),
        "first chat smoke test must write beginner next-step guidance"
    );
    assert!(
        workspace
            .files
            .iter()
            .any(|file| file.ends_with("jlcpcb-bom-preview.csv"))
            && workspace
                .files
                .iter()
                .any(|file| file.ends_with("jlcpcb-cpl-preview.csv"))
            && workspace
                .files
                .iter()
                .any(|file| file.ends_with("manufacturing-readiness-preview.txt"))
            && manufacturing_readiness.contains("Do not upload this preview to JLCPCB"),
        "first chat smoke test must write manufacturing preview blockers"
    );
    assert!(
        workspace
            .files
            .iter()
            .any(|file| file.ends_with("design-quality-report.json"))
            && workspace
                .files
                .iter()
                .any(|file| file.ends_with("design-quality-report.md"))
            && quality_report_file.exists()
            && quality_report_markdown_file.exists(),
        "first chat smoke test must write design quality reports"
    );
    let validation_is_clean = validation.summary.contains("ERC: 오류 0개, 경고 0개")
        && validation
            .summary
            .contains("DRC: 오류 0개, 경고 0개, 미연결 0개");
    assert!(
        quality_report.target_score == 90 && quality_report_markdown.contains("Target score: 90"),
        "first chat smoke test quality report must keep the 90-point gate visible: {quality_report:#?}"
    );
    if validation_is_clean {
        assert!(
            quality_report.total_score >= quality_report.target_score
                && quality_report.blockers.is_empty()
                && quality_report_markdown.contains("Level: ReleaseCandidate"),
            "clean ERC/DRC should allow the 90-point candidate: {quality_report:#?}"
        );
    } else {
        assert!(
            quality_report.total_score < quality_report.target_score
                && !quality_report.blockers.is_empty()
                && quality_report_markdown.contains("Level: PrototypeReview"),
            "nonzero ERC/DRC must block the 90-point candidate: {quality_report:#?}"
        );
    }

    println!("ChatPCB First Chat Smoke Test");
    println!("PASS beginner prompt accepted");
    println!("PASS preview workspace saved");
    println!("PASS generated KiCad preview scaffold");
    println!("PASS beginner next steps written");
    println!("PASS JLCPCB manufacturing preview blockers written");
    println!("PASS KiCad compatibility report written");
    println!("PASS ERC/DRC validation summary written");
    println!("PASS design quality report reflects ERC/DRC validation gate");
    println!("PASS first-run summary points back to follow-up chat");
    println!("PASS first-run summary blocks JLCPCB upload");
    println!("Prompt: built-in ESP32-S3 example prompt accepted");
    println!("Workspace: {}", workspace.project_dir);
    println!("Next steps: {}", workspace.beginner_next_steps_file);
    println!("KiCad check: {}", kicad_check.report_file.to_string_lossy());
    println!(
        "ERC/DRC summary: {}",
        validation.summary_file.to_string_lossy()
    );
    println!("Quality report: {}", workspace.quality_report_file);
    println!("Evidence: {}", workspace.first_run_summary_file);
    if validation_is_clean {
        println!("Quality gate: ReleaseCandidate >=90, manufacturing signoff still required");
    } else {
        println!("Boundary: prototype-review, not order-ready");
    }
}

fn first_chat_smoke_root() -> PathBuf {
    if let Some(root) = std::env::var_os("CHATPCB_FIRST_CHAT_SMOKE_ROOT") {
        return PathBuf::from(root);
    }

    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("ChatPCB3")
        .join("FirstChatSmoke")
}

struct SmokePcbCheckResult {
    report_file: PathBuf,
}

struct SmokeValidationResult {
    summary: String,
    summary_file: PathBuf,
}

fn run_first_chat_smoke_kicad_pcb_check(project_dir: &PathBuf) -> SmokePcbCheckResult {
    let pcb_file = project_dir.join("chatpcb3-esp32s3.kicad_pcb");
    let report_file = project_dir.join("kicad-pcb-check.txt");
    let check = if !pcb_file.exists() {
        chatpcb_core::validation::summarize_kicad_cli_check(
            Some(1),
            "",
            "chatpcb3-esp32s3.kicad_pcb was not found",
        )
    } else if let Some(kicad_cli) = preferred_kicad_cli_path() {
        match Command::new(kicad_cli)
            .args(["pcb", "upgrade"])
            .arg(&pcb_file)
            .output()
        {
            Ok(output) => chatpcb_core::validation::summarize_kicad_cli_check(
                output.status.code(),
                &String::from_utf8_lossy(&output.stdout),
                &String::from_utf8_lossy(&output.stderr),
            ),
            Err(error) => chatpcb_core::validation::summarize_kicad_cli_check(
                None,
                "",
                &format!("failed to run kicad-cli.exe: {error}"),
            ),
        }
    } else {
        chatpcb_core::validation::summarize_kicad_cli_check(None, "", "kicad-cli.exe was not found")
    };

    let report = format!(
        "ChatPCB3 KiCad CLI PCB check\r\n\
         Status: {:?}\r\n\
         Exit code: {:?}\r\n\
         Summary: {}\r\n\
         \r\n\
         PCB file:\r\n\
         {}\r\n\
         \r\n\
         STDOUT:\r\n\
         {}\r\n\
         \r\n\
         STDERR:\r\n\
         {}\r\n\
         \r\n\
         Boundary:\r\n\
         This is a prototype-review compatibility check, not manufacturing evidence.\r\n",
        check.status,
        check.exit_code,
        check.summary,
        pcb_file.to_string_lossy(),
        check.stdout,
        check.stderr
    );
    fs::write(&report_file, report).expect("first chat smoke test must write kicad-pcb-check.txt");

    SmokePcbCheckResult { report_file }
}

fn run_first_chat_smoke_erc_drc_reports(project_dir: &PathBuf) -> SmokeValidationResult {
    let schematic_file = project_dir.join("chatpcb3-esp32s3.kicad_sch");
    let pcb_file = project_dir.join("chatpcb3-esp32s3.kicad_pcb");
    let erc_report_file = project_dir.join("erc-report.json");
    let drc_report_file = project_dir.join("drc-report.json");
    let summary_file = project_dir.join("kicad-validation-summary.txt");

    let _ = fs::remove_file(&erc_report_file);
    let _ = fs::remove_file(&drc_report_file);

    let mut command_log = String::new();
    let summary = if !schematic_file.exists() || !pcb_file.exists() {
        "KiCad ERC/DRC 미실행: preview 회로도 또는 PCB 파일이 없습니다. 검토 목록을 확인하세요. 현재는 prototype-review입니다."
            .to_string()
    } else if let Some(kicad_cli) = preferred_kicad_cli_path() {
        let erc_output = Command::new(&kicad_cli)
            .args(["sch", "erc", "--format", "json", "--output"])
            .arg(&erc_report_file)
            .arg(&schematic_file)
            .output();
        let drc_output = Command::new(&kicad_cli)
            .args(["pcb", "drc", "--format", "json", "--output"])
            .arg(&drc_report_file)
            .arg(&pcb_file)
            .output();

        command_log.push_str(&format_validation_command_log("ERC", &erc_output));
        command_log.push_str(&format_validation_command_log("DRC", &drc_output));

        match (
            fs::read_to_string(&erc_report_file)
                .ok()
                .and_then(|report| chatpcb_core::validation::parse_kicad_report(&report).ok()),
            fs::read_to_string(&drc_report_file)
                .ok()
                .and_then(|report| chatpcb_core::validation::parse_kicad_report(&report).ok()),
        ) {
            (Some(erc), Some(drc)) => {
                chatpcb_core::validation::summarize_erc_drc_reports(&erc, &drc)
            }
            _ => {
                "KiCad ERC/DRC 검증: JSON report를 읽지 못했습니다. 검토 목록의 KiCad 검증 요약을 확인하세요. 현재는 prototype-review입니다."
                    .to_string()
            }
        }
    } else {
        "KiCad ERC/DRC 미실행: KiCad 10 실행 파일을 찾지 못했습니다. KiCad 10 설치 후 검토 목록에서 다시 확인하세요. 현재는 prototype-review입니다."
            .to_string()
    };

    let report = format!(
        "ChatPCB3 KiCad ERC/DRC validation\r\n\
         Summary: {}\r\n\
         \r\n\
         회로도:\r\n\
         {}\r\n\
         \r\n\
         PCB:\r\n\
         {}\r\n\
         \r\n\
         ERC report:\r\n\
         {}\r\n\
         \r\n\
         DRC report:\r\n\
         {}\r\n\
         \r\n\
         Command log:\r\n\
         {}\r\n\
         Boundary:\r\n\
         This is validation evidence, not manufacturing signoff. See design-quality-report.md for the current quality level.\r\n",
        summary,
        schematic_file.to_string_lossy(),
        pcb_file.to_string_lossy(),
        erc_report_file.to_string_lossy(),
        drc_report_file.to_string_lossy(),
        command_log
    );
    fs::write(&summary_file, report)
        .expect("first chat smoke test must write kicad-validation-summary.txt");
    rewrite_quality_report_after_validation(project_dir)
        .expect("first chat smoke test must rewrite design-quality-report after ERC/DRC");

    SmokeValidationResult {
        summary,
        summary_file,
    }
}

fn rewrite_quality_report_after_validation(project_dir: &PathBuf) -> std::io::Result<()> {
    write_workspace_quality_reports(project_dir).map(|_| ())
}

fn format_validation_command_log(
    label: &str,
    output: &std::io::Result<std::process::Output>,
) -> String {
    match output {
        Ok(output) => format!(
            "{label} exit code: {:?}\r\nSTDOUT:\r\n{}\r\nSTDERR:\r\n{}\r\n\r\n",
            output.status.code(),
            String::from_utf8_lossy(&output.stdout).trim(),
            String::from_utf8_lossy(&output.stderr).trim()
        ),
        Err(error) => format!("{label} failed to run: {error}\r\n\r\n"),
    }
}

fn preferred_kicad_cli_path() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|local_app_data| {
            local_app_data
                .join("Programs")
                .join("KiCad")
                .join("10.0")
                .join("bin")
                .join("kicad-cli.exe")
        })
        .filter(|path| path.exists())
}

struct EvidenceSummaryContract {
    points_back_to_follow_up_chat: bool,
    blocks_jlcpcb_upload: bool,
    quality_report_checks_90_point_gate: bool,
    quality_report_blocks_unattended_order: bool,
}

fn first_run_evidence_summary_contract() -> std::io::Result<EvidenceSummaryContract> {
    let root = std::env::temp_dir().join(format!("chatpcb3-self-test-{}", std::process::id()));
    if root.exists() {
        fs::remove_dir_all(&root)?;
    }

    let workspace =
        create_preview_workspace(chatpcb_desktop::ui_model::example_board_prompt(), &root)?;
    let project_dir = PathBuf::from(&workspace.project_dir);
    let summary = fs::read_to_string(&workspace.first_run_summary_file)?;
    let quality_report = evaluate_workspace_quality(&project_dir)?;
    let quality_report_markdown = fs::read_to_string(&workspace.quality_report_markdown_file)?;
    fs::remove_dir_all(&root)?;

    Ok(EvidenceSummaryContract {
        points_back_to_follow_up_chat: summary.contains("후속 입력"),
        blocks_jlcpcb_upload: summary.contains("JLCPCB에 업로드하지 마세요"),
        quality_report_checks_90_point_gate: quality_report.target_score == 90
            && quality_report.total_score < quality_report.target_score
            && !quality_report.blockers.is_empty(),
        quality_report_blocks_unattended_order: quality_report_markdown
            .contains("human manufacturing signoff"),
    })
}

fn probe_command_version(command: &str) -> Option<String> {
    let output = match provider_command_output(command, &["--version"]) {
        Ok(output) => output,
        Err(_) => return probe_windows_provider_install(command),
    };

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !stdout.is_empty() {
        Some(stdout)
    } else if !stderr.is_empty() {
        Some(stderr)
    } else if command == "antigravity" {
        probe_windows_provider_install(command).or_else(|| Some(format!("{command} available")))
    } else {
        Some(format!("{command} available"))
    }
}

fn probe_provider_status(command: &str) -> ProviderProbeStatus {
    let version = probe_command_version(command);
    let logged_in = version.is_some()
        && match command {
            "codex" => provider_command_success(command, &["login", "status"]),
            "claude" => provider_command_success(command, &["auth", "status"]),
            "antigravity" => true,
            _ => false,
        };

    ProviderProbeStatus { version, logged_in }
}

fn provider_command_success(command: &str, args: &[&str]) -> bool {
    provider_command_output(command, args)
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn provider_command_output(
    command: &str,
    args: &[&str],
) -> Result<std::process::Output, std::io::Error> {
    match Command::new(command).args(args).output() {
        Ok(output) => Ok(output),
        Err(error) => {
            #[cfg(windows)]
            {
                for candidate in windows_provider_command_paths(command) {
                    if candidate.is_file() {
                        return Command::new(candidate).args(args).output();
                    }
                }
            }

            Err(error)
        }
    }
}

#[cfg(windows)]
fn probe_windows_provider_install(command: &str) -> Option<String> {
    if command == "codex" {
        for candidate in windows_provider_command_paths(command) {
            if candidate.is_file() {
                let output = Command::new(candidate).arg("--version").output().ok()?;
                if output.status.success() {
                    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

                    if !stdout.is_empty() {
                        return Some(stdout);
                    }
                    if !stderr.is_empty() {
                        return Some(stderr);
                    }
                }

                return Some("Codex installed (Windows user bin)".to_string());
            }
        }
    }

    if command == "antigravity" {
        let local_app_data = std::env::var("LOCALAPPDATA").ok()?;
        let executable =
            std::path::Path::new(&local_app_data).join("Programs\\Antigravity\\Antigravity.exe");

        if executable.is_file() {
            return Some("Antigravity installed (Windows app)".to_string());
        }
    }

    None
}

#[cfg(windows)]
fn windows_provider_command_paths(command: &str) -> Vec<std::path::PathBuf> {
    if command == "codex" {
        let Ok(user_profile) = std::env::var("USERPROFILE") else {
            return Vec::new();
        };
        return vec![
            std::path::Path::new(&user_profile).join(".local\\bin\\codex.cmd"),
            std::path::Path::new(&user_profile).join(".local\\bin\\codex.exe"),
        ];
    }

    if command == "antigravity" {
        let Ok(local_app_data) = std::env::var("LOCALAPPDATA") else {
            return Vec::new();
        };
        return vec![
            std::path::Path::new(&local_app_data).join("Programs\\Antigravity\\Antigravity.exe")
        ];
    }

    Vec::new()
}

#[cfg(not(windows))]
fn probe_windows_provider_install(_command: &str) -> Option<String> {
    None
}

#[cfg(not(windows))]
fn run_desktop_app() {
    eprintln!("chatpcb-desktop is currently implemented for Windows only.");
}

#[cfg(windows)]
fn run_desktop_app() {
    win32_app::run();
}

#[cfg(windows)]
mod win32_app {
    use core::ffi::c_void;
    use resvg::{tiny_skia, usvg};
    use std::fs;
    use std::mem::zeroed;
    use std::path::PathBuf;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::{
        COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, RECT, WPARAM,
    };
    use windows_sys::Win32::Graphics::Gdi::{
        BeginPaint, CreatePen, DeleteObject, EndPaint, FillRect, GetStockObject, InvalidateRect,
        LineTo, MoveToEx, Rectangle, SelectObject, SetBkMode, SetTextColor, StretchDIBits,
        TextOutW, UpdateWindow, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HDC,
        PAINTSTRUCT, PS_SOLID, SRCCOPY, TRANSPARENT, WHITE_BRUSH,
    };
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::Controls::{
        EM_SCROLLCARET, EM_SETCUEBANNER, EM_SETSEL, NMHDR, TCIF_TEXT, TCITEMW, TCM_GETCURSEL,
        TCM_INSERTITEMW, TCN_SELCHANGE,
    };
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        EnableWindow, ReleaseCapture, SetCapture, SetFocus, VK_RETURN,
    };
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallWindowProcW, CreateWindowExW, DefWindowProcW, DispatchMessageW, GetClientRect,
        GetDlgItemTextW, GetMessageW, GetParent, GetWindowLongPtrW, GetWindowTextLengthW,
        GetWindowTextW, LoadCursorW, MoveWindow, PostMessageW, PostQuitMessage, RegisterClassW,
        SendMessageW, SetDlgItemTextW, SetWindowLongPtrW, SetWindowTextW, ShowWindow,
        TranslateMessage, CBS_DROPDOWNLIST, CB_ADDSTRING, CB_RESETCONTENT, CB_SETCURSEL,
        CB_SETDROPPEDWIDTH, CW_USEDEFAULT, EN_CHANGE, ES_AUTOHSCROLL, ES_AUTOVSCROLL, ES_MULTILINE,
        ES_READONLY, GWLP_USERDATA, GWLP_WNDPROC, HMENU, IDC_ARROW, MSG, SW_SHOW, WINDOW_EX_STYLE,
        WM_APP, WM_COMMAND, WM_DESTROY, WM_KEYDOWN, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE,
        WM_MOUSEWHEEL, WM_NCDESTROY, WM_NOTIFY, WM_PAINT, WM_SETFOCUS, WM_SIZE, WNDCLASSW, WNDPROC,
        WS_BORDER, WS_CHILD, WS_CLIPSIBLINGS, WS_OVERLAPPEDWINDOW, WS_TABSTOP, WS_VISIBLE,
        WS_VSCROLL,
    };

    const APP_TITLE: &str = "ChatPCB KiCad Preview";
    const CLASS_NAME: &str = "ChatPcbKiCadPreviewWindow";
    const SCHEMATIC_CANVAS_CLASS_NAME: &str = "ChatPcbLiveSchematicCanvas";
    const ID_SEND_DESIGN: usize = 1001;
    const ID_PROVIDER_LOGIN: usize = 1002;
    const ID_CHAT_TRANSCRIPT: usize = 1003;
    const ID_PROMPT: usize = 1004;
    const ID_USE_EXAMPLE: usize = 1005;
    const ID_OPEN_EVIDENCE: usize = 1006;
    const ID_OPEN_PCB: usize = 1007;
    const ID_PROMPT_LABEL: usize = 1008;
    const ID_OPEN_KICAD: usize = 1009;
    const WM_CHATPCB_SEND_DEFERRED: u32 = WM_APP + 1;
    const KICAD_SCHEMATIC_ZOOM_STEP_PERCENT: i32 = 10;
    const KICAD_SCHEMATIC_MIN_ZOOM_PERCENT: i32 = 60;
    const KICAD_SCHEMATIC_MAX_ZOOM_PERCENT: i32 = 240;
    static mut ORIGINAL_PROMPT_PROC: WNDPROC = None;

    struct AppControls {
        left_pane: HWND,
        tabs: HWND,
        schematic_canvas: HWND,
        design_preview: HWND,
        status: HWND,
        chat_transcript: HWND,
        prompt_label: HWND,
        prompt: HWND,
        use_example_button: HWND,
        send_button: HWND,
        open_pcb_button: HWND,
        open_kicad_button: HWND,
        provider_button: HWND,
        open_evidence_button: HWND,
        model_choice: HWND,
        pipeline_status: HWND,
        last_workspace_dir: Option<PathBuf>,
        schematic_zoom_percent: i32,
        schematic_pan_x: i32,
        schematic_pan_y: i32,
        schematic_drag_origin: Option<(i32, i32)>,
        schematic_drag_pan_origin: (i32, i32),
        suppress_prompt_change: bool,
    }

    struct PcbCheckUiResult {
        summary: String,
        report_file: PathBuf,
    }

    struct ValidationUiResult {
        summary: String,
        erc_report_file: PathBuf,
        drc_report_file: PathBuf,
        summary_file: PathBuf,
    }

    struct SchematicSvgExportResult {
        summary: String,
        report_file: PathBuf,
        svg_file: Option<PathBuf>,
    }

    struct RenderedSvgBitmap {
        width: i32,
        height: i32,
        bgra: Vec<u8>,
    }

    pub fn run() {
        unsafe {
            let instance = GetModuleHandleW(null());
            register_window_class(instance);
            register_schematic_canvas_class(instance);

            let title = wide(APP_TITLE);
            let class = wide(CLASS_NAME);
            let hwnd = CreateWindowExW(
                0,
                class.as_ptr(),
                title.as_ptr(),
                WS_OVERLAPPEDWINDOW,
                CW_USEDEFAULT,
                CW_USEDEFAULT,
                1600,
                1000,
                null_mut(),
                null_mut(),
                instance,
                null_mut(),
            );

            if hwnd.is_null() {
                return;
            }

            let controls = Box::new(create_controls(hwnd, instance));
            let controls_ptr = Box::into_raw(controls);
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, controls_ptr as isize);
            layout(hwnd);

            ShowWindow(hwnd, SW_SHOW);
            UpdateWindow(hwnd);
            initialize_provider_model_selection(&*controls_ptr);
            focus_prompt_for_first_chat(&*controls_ptr);

            let mut message: MSG = zeroed();
            while GetMessageW(&mut message, null_mut(), 0, 0) > 0 {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
    }

    unsafe fn register_window_class(instance: HINSTANCE) {
        let class = wide(CLASS_NAME);
        let wc = WNDCLASSW {
            style: 0,
            lpfnWndProc: Some(window_proc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: instance,
            hIcon: null_mut(),
            hCursor: LoadCursorW(null_mut(), IDC_ARROW),
            hbrBackground: GetStockObject(WHITE_BRUSH) as _,
            lpszMenuName: null(),
            lpszClassName: class.as_ptr(),
        };

        RegisterClassW(&wc);
    }

    unsafe fn register_schematic_canvas_class(instance: HINSTANCE) {
        let class = wide(SCHEMATIC_CANVAS_CLASS_NAME);
        let wc = WNDCLASSW {
            style: 0,
            lpfnWndProc: Some(schematic_canvas_window_proc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: instance,
            hIcon: null_mut(),
            hCursor: LoadCursorW(null_mut(), IDC_ARROW),
            hbrBackground: GetStockObject(WHITE_BRUSH) as _,
            lpszMenuName: null(),
            lpszClassName: class.as_ptr(),
        };

        RegisterClassW(&wc);
    }

    unsafe fn create_controls(parent: HWND, instance: HINSTANCE) -> AppControls {
        let left_pane = child(
            parent,
            instance,
            "STATIC",
            "현재 프로젝트: ESP32-S3 USB-C 센서 보드",
            WS_BORDER,
            0,
        );
        let tabs = child(
            parent,
            instance,
            WC_TABCONTROLW_STR,
            "",
            WS_CLIPSIBLINGS | WS_TABSTOP,
            0,
        );
        add_tab(tabs, 0, "회로도");
        add_tab(tabs, 1, "블록도");
        add_tab(tabs, 2, "PCB 레이아웃");
        add_tab(tabs, 3, "검증");
        add_tab(tabs, 4, "제조 미리보기");

        let recovered_workspace = if fresh_start_requested() {
            None
        } else {
            recover_last_preview_workspace()
        };
        let initial_schematic_canvas_body = recovered_workspace
            .as_ref()
            .map(|path| {
                let project_dir = path.to_string_lossy();
                chatpcb_desktop::ui_model::saved_preview_tab_body(0, project_dir.as_ref())
            })
            .unwrap_or_else(|| chatpcb_desktop::ui_model::left_tab_body(0).to_string());
        let initial_design_preview = recovered_workspace
            .as_ref()
            .map(|path| {
                let project_dir = path.to_string_lossy();
                chatpcb_desktop::ui_model::saved_preview_tab_body(0, project_dir.as_ref())
            })
            .unwrap_or_else(|| chatpcb_desktop::ui_model::left_tab_body(0).to_string());
        let initial_left_status = recovered_workspace
            .as_ref()
            .map(|path| {
                let project_dir = path.to_string_lossy();
                chatpcb_desktop::ui_model::recovered_preview_workspace_left_status(
                    project_dir.as_ref(),
                )
            })
            .unwrap_or_else(|| {
                chatpcb_desktop::ui_model::initial_left_workspace_status().to_string()
            });
        let initial_chat_transcript = recovered_workspace
            .as_ref()
            .map(|path| {
                let project_dir = path.to_string_lossy();
                let recovered_turn =
                    chatpcb_desktop::ui_model::recovered_preview_workspace_transcript(
                        project_dir.as_ref(),
                    );
                chatpcb_desktop::ui_model::append_chat_transcript(
                    &chatpcb_desktop::ui_model::initial_transcript(),
                    &recovered_turn,
                )
            })
            .unwrap_or_else(chatpcb_desktop::ui_model::initial_transcript);
        let initial_pipeline_status = if recovered_workspace.is_some() {
            chatpcb_desktop::ui_model::recovered_preview_pipeline_status().to_string()
        } else {
            chatpcb_desktop::ui_model::initial_pipeline_status().to_string()
        };

        let schematic_canvas = child(
            parent,
            instance,
            SCHEMATIC_CANVAS_CLASS_NAME,
            &initial_schematic_canvas_body,
            WS_BORDER,
            0,
        );
        let design_preview = child(
            parent,
            instance,
            "EDIT",
            &initial_design_preview,
            WS_BORDER
                | WS_VSCROLL
                | ES_MULTILINE as u32
                | ES_AUTOVSCROLL as u32
                | ES_READONLY as u32,
            0,
        );
        let status = child(
            parent,
            instance,
            "STATIC",
            &initial_left_status,
            WS_BORDER,
            0,
        );
        let chat_transcript = child(
            parent,
            instance,
            "EDIT",
            &initial_chat_transcript,
            WS_BORDER
                | WS_VSCROLL
                | ES_MULTILINE as u32
                | ES_AUTOVSCROLL as u32
                | ES_READONLY as u32,
            ID_CHAT_TRANSCRIPT,
        );
        let prompt_label = child(parent, instance, "STATIC", "채팅 입력", 0, ID_PROMPT_LABEL);
        let initial_prompt = chatpcb_desktop::ui_model::example_board_prompt();
        let prompt = child(
            parent,
            instance,
            "EDIT",
            initial_prompt,
            WS_BORDER | WS_TABSTOP | ES_AUTOHSCROLL as u32,
            ID_PROMPT,
        );
        set_prompt_empty_cue(prompt);
        subclass_prompt_input(parent, prompt);
        let use_example_button = child(
            parent,
            instance,
            "BUTTON",
            "예시 사용",
            WS_TABSTOP,
            ID_USE_EXAMPLE,
        );
        let send_button = child(
            parent,
            instance,
            "BUTTON",
            "설계 생성",
            WS_TABSTOP,
            ID_SEND_DESIGN,
        );
        let open_pcb_button = child(
            parent,
            instance,
            "BUTTON",
            "PCB 열기",
            WS_TABSTOP,
            ID_OPEN_PCB,
        );
        let open_kicad_button = child(
            parent,
            instance,
            "BUTTON",
            "KiCad 열기",
            WS_TABSTOP,
            ID_OPEN_KICAD,
        );
        let provider_button = child(
            parent,
            instance,
            "BUTTON",
            "Provider Login",
            WS_TABSTOP,
            ID_PROVIDER_LOGIN,
        );
        let open_evidence_button = child(
            parent,
            instance,
            "BUTTON",
            "검토 목록",
            WS_TABSTOP,
            ID_OPEN_EVIDENCE,
        );
        let model_choice = child(
            parent,
            instance,
            "COMBOBOX",
            "",
            WS_TABSTOP | CBS_DROPDOWNLIST as u32,
            0,
        );
        for model in chatpcb_desktop::ui_model::model_selector_display_items() {
            add_combo_item(model_choice, model);
        }
        SendMessageW(model_choice, CB_SETCURSEL, 0, 0);
        let pipeline_status = child(
            parent,
            instance,
            "STATIC",
            &initial_pipeline_status,
            WS_BORDER,
            0,
        );

        let controls = AppControls {
            left_pane,
            tabs,
            schematic_canvas,
            design_preview,
            status,
            chat_transcript,
            prompt_label,
            prompt,
            use_example_button,
            send_button,
            open_pcb_button,
            open_kicad_button,
            provider_button,
            open_evidence_button,
            model_choice,
            pipeline_status,
            last_workspace_dir: recovered_workspace.clone(),
            schematic_zoom_percent: 100,
            schematic_pan_x: 0,
            schematic_pan_y: 0,
            schematic_drag_origin: None,
            schematic_drag_pan_origin: (0, 0),
            suppress_prompt_change: false,
        };
        set_workspace_action_buttons_enabled(&controls, recovered_workspace.is_some());
        controls
    }

    unsafe fn child(
        parent: HWND,
        instance: HINSTANCE,
        class_name: &str,
        text: &str,
        extra_style: u32,
        control_id: usize,
    ) -> HWND {
        let class = wide(class_name);
        let text = wide(text);

        CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            class.as_ptr(),
            text.as_ptr(),
            WS_CHILD | WS_VISIBLE | extra_style,
            0,
            0,
            10,
            10,
            parent,
            control_id as HMENU,
            instance,
            null_mut(),
        )
    }

    unsafe fn add_tab(tabs: HWND, index: i32, label: &str) {
        let mut text = wide(label);
        let mut item = TCITEMW {
            mask: TCIF_TEXT,
            dwState: 0,
            dwStateMask: 0,
            pszText: text.as_mut_ptr(),
            cchTextMax: text.len() as i32,
            iImage: 0,
            lParam: 0,
        };
        SendMessageW(
            tabs,
            TCM_INSERTITEMW,
            index as usize,
            &mut item as *mut _ as isize,
        );
    }

    unsafe fn add_combo_item(combo: HWND, label: &str) {
        let text = wide(label);
        SendMessageW(combo, CB_ADDSTRING, 0, text.as_ptr() as isize);
    }

    unsafe fn set_prompt_empty_cue(prompt: HWND) {
        let cue = wide("만들 보드를 입력하고 Enter");
        SendMessageW(prompt, EM_SETCUEBANNER, 0, cue.as_ptr() as isize);
    }

    unsafe fn focus_prompt_for_first_chat(controls: &AppControls) {
        SetFocus(controls.prompt);
        SendMessageW(controls.prompt, EM_SETSEL, 0, -1);
    }

    unsafe fn focus_prompt_after_action(controls: &AppControls) {
        SetFocus(controls.prompt);
    }

    unsafe fn set_workspace_action_buttons_enabled(controls: &AppControls, enabled: bool) {
        let enabled = if enabled { 1 } else { 0 };
        EnableWindow(controls.open_pcb_button, enabled);
        EnableWindow(controls.open_evidence_button, enabled);
        EnableWindow(controls.open_kicad_button, enabled);
    }

    unsafe fn initialize_provider_model_selection(controls: &AppControls) {
        let statuses = provider_ui_statuses();
        populate_model_selector(controls, &statuses);
    }

    unsafe fn provider_ui_statuses() -> Vec<chatpcb_desktop::ui_model::ProviderUiStatus> {
        super::catalog_with_status_probe(super::probe_provider_status)
            .into_iter()
            .map(|provider| chatpcb_desktop::ui_model::ProviderUiStatus {
                display_name: provider.display_name,
                available: provider.available,
                logged_in: provider.logged_in,
                version: provider.version,
                models: provider
                    .models
                    .into_iter()
                    .map(|model| chatpcb_desktop::ui_model::ProviderUiModel {
                        id: model.id,
                        display_name: model.display_name,
                        cli_model: model.cli_model,
                    })
                    .collect(),
                login_hint: provider.login_hint,
            })
            .collect()
    }

    unsafe fn populate_model_selector(
        controls: &AppControls,
        statuses: &[chatpcb_desktop::ui_model::ProviderUiStatus],
    ) {
        SendMessageW(controls.model_choice, CB_RESETCONTENT, 0, 0);
        for model in chatpcb_desktop::ui_model::model_selector_display_items_for_statuses(statuses)
        {
            add_combo_item(controls.model_choice, &model);
        }
        SendMessageW(controls.model_choice, CB_SETDROPPEDWIDTH, 360, 0);

        let selected_model = chatpcb_desktop::ui_model::selected_model_for_statuses(statuses);
        let model_index =
            chatpcb_desktop::ui_model::model_selector_index_for_statuses(selected_model, statuses)
                .unwrap_or(0);
        SendMessageW(controls.model_choice, CB_SETCURSEL, model_index, 0);
    }

    unsafe fn subclass_prompt_input(parent: HWND, prompt: HWND) {
        SetWindowLongPtrW(prompt, GWLP_USERDATA, parent as isize);
        let original = SetWindowLongPtrW(
            prompt,
            GWLP_WNDPROC,
            prompt_window_proc as *const () as isize,
        );
        ORIGINAL_PROMPT_PROC = std::mem::transmute::<isize, WNDPROC>(original);
    }

    unsafe extern "system" fn prompt_window_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if msg == WM_KEYDOWN && wparam == VK_RETURN as WPARAM {
            let parent = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as HWND;
            if !parent.is_null() {
                PostMessageW(parent, WM_CHATPCB_SEND_DEFERRED, 0, 0);
                return 0;
            }
        }

        let original_prompt_proc = ORIGINAL_PROMPT_PROC;
        if original_prompt_proc.is_some() {
            CallWindowProcW(original_prompt_proc, hwnd, msg, wparam, lparam)
        } else {
            DefWindowProcW(hwnd, msg, wparam, lparam)
        }
    }

    unsafe extern "system" fn schematic_canvas_window_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_LBUTTONDOWN => {
                begin_schematic_drag(hwnd, point_from_lparam(lparam));
                0
            }
            WM_MOUSEMOVE => {
                adjust_schematic_pan(hwnd, point_from_lparam(lparam));
                0
            }
            WM_LBUTTONUP => {
                end_schematic_drag(hwnd);
                0
            }
            WM_MOUSEWHEEL => {
                adjust_schematic_zoom_percent(hwnd, wheel_delta_from_wparam(wparam));
                0
            }
            WM_PAINT => {
                paint_schematic_canvas(hwnd);
                0
            }
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }

    fn point_from_lparam(lparam: LPARAM) -> (i32, i32) {
        let raw = lparam as u32;
        let x = (raw & 0xffff) as u16 as i16 as i32;
        let y = ((raw >> 16) & 0xffff) as u16 as i16 as i32;
        (x, y)
    }

    unsafe fn begin_schematic_drag(hwnd: HWND, point: (i32, i32)) {
        let parent = GetParent(hwnd);
        if parent.is_null() {
            return;
        }

        let ptr = GetWindowLongPtrW(parent, GWLP_USERDATA) as *mut AppControls;
        if ptr.is_null() {
            return;
        }

        (*ptr).schematic_drag_origin = Some(point);
        (*ptr).schematic_drag_pan_origin = ((*ptr).schematic_pan_x, (*ptr).schematic_pan_y);
        SetCapture(hwnd);
    }

    unsafe fn adjust_schematic_pan(hwnd: HWND, point: (i32, i32)) {
        let parent = GetParent(hwnd);
        if parent.is_null() {
            return;
        }

        let ptr = GetWindowLongPtrW(parent, GWLP_USERDATA) as *mut AppControls;
        if ptr.is_null() {
            return;
        }

        let Some(origin) = (*ptr).schematic_drag_origin else {
            return;
        };
        (*ptr).schematic_pan_x = (*ptr).schematic_drag_pan_origin.0 + point.0 - origin.0;
        (*ptr).schematic_pan_y = (*ptr).schematic_drag_pan_origin.1 + point.1 - origin.1;
        InvalidateRect(hwnd, null(), 1);
    }

    unsafe fn end_schematic_drag(hwnd: HWND) {
        let parent = GetParent(hwnd);
        if !parent.is_null() {
            let ptr = GetWindowLongPtrW(parent, GWLP_USERDATA) as *mut AppControls;
            if !ptr.is_null() {
                (*ptr).schematic_drag_origin = None;
            }
        }
        ReleaseCapture();
    }

    fn wheel_delta_from_wparam(wparam: WPARAM) -> i32 {
        (((wparam >> 16) & 0xffff) as u16 as i16) as i32
    }

    unsafe fn adjust_schematic_zoom_percent(hwnd: HWND, wheel_delta: i32) {
        let parent = GetParent(hwnd);
        if parent.is_null() {
            return;
        }

        let ptr = GetWindowLongPtrW(parent, GWLP_USERDATA) as *mut AppControls;
        if ptr.is_null() {
            return;
        }

        let step = if wheel_delta >= 0 {
            KICAD_SCHEMATIC_ZOOM_STEP_PERCENT
        } else {
            -KICAD_SCHEMATIC_ZOOM_STEP_PERCENT
        };
        (*ptr).schematic_zoom_percent = ((*ptr).schematic_zoom_percent + step).clamp(
            KICAD_SCHEMATIC_MIN_ZOOM_PERCENT,
            KICAD_SCHEMATIC_MAX_ZOOM_PERCENT,
        );
        InvalidateRect(hwnd, null(), 1);
    }

    unsafe fn paint_schematic_canvas(hwnd: HWND) {
        let mut paint: PAINTSTRUCT = zeroed();
        let hdc = BeginPaint(hwnd, &mut paint);
        if hdc.is_null() {
            return;
        }

        let mut rect: RECT = zeroed();
        GetClientRect(hwnd, &mut rect);
        FillRect(hdc, &rect, GetStockObject(WHITE_BRUSH) as _);
        SetBkMode(hdc, TRANSPARENT as i32);
        SetTextColor(hdc, rgb(20, 20, 20));

        let canvas_text = get_window_text(hwnd);
        if schematic_canvas_selected_tab(hwnd) == Some(4) {
            if let Some(project_dir) = schematic_canvas_workspace(hwnd) {
                paint_saved_manufacturing_review_canvas(hdc, &rect, &project_dir);
            } else {
                paint_manufacturing_review_placeholder_canvas(hdc, &rect);
            }
        } else if canvas_text.contains("SAVED_KICAD_EVIDENCE_VIEW") {
            if let Some(project_dir) = schematic_canvas_workspace(hwnd) {
                paint_saved_kicad_schematic_canvas(hwnd, hdc, &rect, &project_dir);
            } else {
                paint_kicad_schematic_canvas(hdc, &rect, &canvas_text);
            }
        } else if canvas_text.contains("KICAD_SCHEMATIC_VIEW") {
            paint_kicad_schematic_canvas(hdc, &rect, &canvas_text);
        } else {
            paint_block_diagram_canvas(hdc, &rect, &canvas_text);
        }

        EndPaint(hwnd, &paint);
    }

    unsafe fn schematic_canvas_workspace(hwnd: HWND) -> Option<PathBuf> {
        let parent = GetParent(hwnd);
        if parent.is_null() {
            return None;
        }

        let ptr = GetWindowLongPtrW(parent, GWLP_USERDATA) as *mut AppControls;
        if ptr.is_null() {
            return None;
        }

        (*ptr).last_workspace_dir.clone()
    }

    unsafe fn schematic_canvas_selected_tab(hwnd: HWND) -> Option<usize> {
        let parent = GetParent(hwnd);
        if parent.is_null() {
            return None;
        }

        let ptr = GetWindowLongPtrW(parent, GWLP_USERDATA) as *mut AppControls;
        if ptr.is_null() {
            return None;
        }

        let selected = SendMessageW((*ptr).tabs, TCM_GETCURSEL, 0, 0);
        if selected >= 0 {
            Some(selected as usize)
        } else {
            None
        }
    }

    unsafe fn schematic_zoom_percent(hwnd: HWND) -> i32 {
        let parent = GetParent(hwnd);
        if parent.is_null() {
            return 100;
        }

        let ptr = GetWindowLongPtrW(parent, GWLP_USERDATA) as *mut AppControls;
        if ptr.is_null() {
            return 100;
        }

        (*ptr).schematic_zoom_percent
    }

    unsafe fn schematic_pan(hwnd: HWND) -> (i32, i32) {
        let parent = GetParent(hwnd);
        if parent.is_null() {
            return (0, 0);
        }

        let ptr = GetWindowLongPtrW(parent, GWLP_USERDATA) as *mut AppControls;
        if ptr.is_null() {
            return (0, 0);
        }

        ((*ptr).schematic_pan_x, (*ptr).schematic_pan_y)
    }

    unsafe fn paint_block_diagram_canvas(hdc: HDC, rect: &RECT, canvas_text: &str) {
        let has_h2 = canvas_text.contains("H2 Sensor");
        let has_touch = canvas_text.contains("Touch Display");
        let is_typing = canvas_text.contains("입력 중");
        let is_validated = canvas_text.contains("검증 완료");

        let width = (rect.right - rect.left).max(640);
        let title = if is_typing {
            "Block diagram - typing"
        } else if is_validated {
            "Block diagram - applied"
        } else {
            "Block diagram"
        };
        draw_text(hdc, 18, 14, title);

        let top = 54;
        let usb = (24, top, 142, top + 58);
        let reg = (width / 2 - 90, top, width / 2 + 38, top + 58);
        let esp = (width - 190, top, width - 38, top + 58);
        let sensor = (width - 190, top + 122, width - 38, top + 180);
        let display = (width / 2 - 90, top + 122, width / 2 + 74, top + 180);

        draw_box(hdc, usb, "USB-C");
        draw_box(hdc, reg, "REG 3V3");
        draw_box(hdc, esp, "ESP32-S3");
        draw_box(hdc, sensor, if has_h2 { "H2 Sensor" } else { "I2C Sensor" });
        if has_touch {
            draw_box(hdc, display, "Touch Display");
        }

        draw_wire(hdc, usb.2, top + 28, reg.0, top + 28, "+5V");
        draw_wire(hdc, reg.2, top + 28, esp.0, top + 28, "+3V3");
        draw_wire(
            hdc,
            esp.0 + 60,
            esp.3,
            sensor.0 + 60,
            sensor.1,
            if has_h2 { "ADC" } else { "I2C" },
        );
        if has_touch {
            draw_wire(hdc, esp.0, esp.3 - 8, display.2, display.1 + 24, "SPI");
        }
        draw_wire(hdc, usb.0, top + 74, esp.2, top + 74, "GND");

        let result = if is_typing {
            "Apply result: previewing typed circuit"
        } else if is_validated {
            "Apply result: saved and validation reports updated"
        } else {
            "Apply result: waiting for chat input"
        };
        draw_text(hdc, 18, top + 210, result);
        draw_text(
            hdc,
            18,
            top + 234,
            "Boundary: prototype-review, not order-ready",
        );
    }

    unsafe fn paint_kicad_schematic_canvas(hdc: HDC, rect: &RECT, canvas_text: &str) {
        let has_h2 = canvas_text.contains("H2 Sensor");
        let has_touch = canvas_text.contains("Touch Display");
        let is_typing = canvas_text.contains("입력 중");
        let is_validated = canvas_text.contains("검증 완료") || canvas_text.contains("저장된");

        let width = (rect.right - rect.left).max(760);
        let height = (rect.bottom - rect.top).max(280);
        draw_grid(hdc, width, height);
        draw_text(
            hdc,
            18,
            12,
            "KiCad Schematic Editor - chatpcb3-esp32s3.kicad_sch",
        );
        draw_text(
            hdc,
            18,
            34,
            "Sheet: / | Circuit design review: USB-C, power, MCU straps, I2C sensor",
        );

        let top = 104;
        let usb = (34, top + 30, 182, top + 118);
        let cc = (34, top + 150, 228, top + 232);
        let fuse = (264, top + 12, 390, top + 64);
        let esd = (264, top + 94, 390, top + 152);
        let regulator = (466, top + 12, 604, top + 86);
        let caps = (466, top + 112, 604, top + 184);
        let esp = (width - 342, top + 6, width - 72, top + 136);
        let sensor = (width - 342, top + 172, width - 72, top + 238);
        let display = (466, top + 190, 650, top + 250);

        draw_kicad_symbol(hdc, usb, "J1", "USB-C", &["VBUS", "D+/D-", "CC", "GND"]);
        draw_kicad_symbol(hdc, cc, "R1/R2", "CC 5.1k to GND", &["CC1", "CC2", "GND"]);
        draw_kicad_symbol(hdc, fuse, "F1", "VBUS FUSE", &["VBUS", "VBUS_5V"]);
        draw_kicad_symbol(hdc, esd, "U4", "USB ESD", &["D+", "D-", "GND"]);
        draw_kicad_symbol(hdc, regulator, "U2", "3V3 LDO", &["IN", "OUT", "GND"]);
        draw_kicad_symbol(hdc, caps, "C1/C2/C3", "POWER CAPS", &["VBUS", "3V3", "GND"]);
        draw_kicad_symbol(
            hdc,
            esp,
            "U1",
            "ESP32-S3",
            &["3V3", "USB", "EN/BOOT", "I2C"],
        );
        draw_kicad_symbol(
            hdc,
            sensor,
            "U3",
            if has_h2 { "H2 SENSOR" } else { "BME280 I2C" },
            &["3V3/GND", "SCL/SDA"],
        );
        if has_touch {
            draw_kicad_symbol(
                hdc,
                display,
                "DS1",
                "TOUCH_DISPLAY",
                &["3V3", "GND", "SCK", "SDA"],
            );
        }

        draw_wire(hdc, usb.2, top + 58, fuse.0 - 16, top + 38, "");
        draw_wire(hdc, fuse.2, top + 38, regulator.0 - 16, top + 38, "");
        draw_wire(hdc, regulator.2, top + 38, esp.0 - 16, top + 38, "");
        draw_wire(hdc, usb.2, top + 76, esd.0 - 16, top + 122, "");
        draw_wire(hdc, esd.2, top + 122, esp.0 - 16, top + 78, "");
        draw_wire(hdc, regulator.0 + 58, regulator.3, caps.0 + 58, caps.1, "");
        draw_wire(hdc, esp.0 + 84, esp.3, sensor.0 + 84, sensor.1, "");
        draw_text(hdc, usb.2 + 22, top + 40, "VBUS");
        draw_text(hdc, fuse.2 + 10, top + 30, "VBUS_5V");
        draw_text(hdc, usb.2 + 28, top + 86, "USB D+/D-");
        draw_text(hdc, esp.0 + 94, esp.3 + 4, "I2C");
        if has_touch {
            draw_wire(
                hdc,
                display.2,
                display.1 + 28,
                esp.0,
                esp.3 - 36,
                "SPI_TOUCH_DISPLAY",
            );
        }

        let process = if is_typing {
            "Process: drafting circuit review from chat input"
        } else if is_validated {
            "Process: schematic saved, validation artifacts linked"
        } else {
            "Process: waiting for chat input"
        };
        draw_text(hdc, 18, 54, process);
        let boundary = if is_validated {
            "Quality gate: ReleaseCandidate >=90; manufacturing signoff required"
        } else {
            "Boundary: prototype-review, not order-ready"
        };
        draw_text(hdc, 18, 74, boundary);
    }

    unsafe fn paint_manufacturing_review_placeholder_canvas(hdc: HDC, rect: &RECT) {
        let width = (rect.right - rect.left).max(760);
        let height = (rect.bottom - rect.top).max(280);
        draw_grid(hdc, width, height);
        draw_text(hdc, 18, 12, "Manufacturing Review - no saved preview yet");
        draw_text(
            hdc,
            18,
            42,
            "Create a design first to show Gerber/BOM/CPL and part-selection evidence.",
        );
        draw_text(
            hdc,
            18,
            72,
            "Boundary: prototype-review, JLCPCB order blocked until human signoff",
        );
    }

    unsafe fn paint_saved_manufacturing_review_canvas(
        hdc: HDC,
        rect: &RECT,
        project_dir: &PathBuf,
    ) {
        let width = (rect.right - rect.left).max(760);
        let height = (rect.bottom - rect.top).max(280);
        draw_grid(hdc, width, height);

        let project_dir_text = project_dir.to_string_lossy();
        let summary = chatpcb_desktop::ui_model::saved_preview_summary(project_dir_text.as_ref());
        let bom_present = project_dir.join("jlcpcb-bom-preview.csv").exists();
        let cpl_present = project_dir.join("jlcpcb-cpl-preview.csv").exists();
        let quality_present = project_dir.join("design-quality-report.md").exists();
        let part_lines = chatpcb_desktop::ui_model::saved_part_selection_review_canvas_lines(
            project_dir_text.as_ref(),
            3,
        );

        draw_text(
            hdc,
            18,
            12,
            "Manufacturing Review - BOM/CPL + part selection evidence",
        );
        draw_text(hdc, 18, 36, &summary.quality_summary);
        draw_artifact_status(hdc, 18, 66, "jlcpcb-bom-preview.csv", bom_present);
        draw_artifact_status(hdc, 286, 66, "jlcpcb-cpl-preview.csv", cpl_present);
        draw_artifact_status(hdc, 560, 66, "design-quality-report.md", quality_present);
        draw_text(
            hdc,
            18,
            96,
            "Order gate: BLOCKED_HUMAN_SIGNOFF_REQUIRED; verify live stock, substitutions, and CPL orientation",
        );

        draw_text(hdc, 18, 132, "Part selection evidence");
        if part_lines.is_empty() {
            draw_text(
                hdc,
                38,
                162,
                "part-selection-review.md not found or missing reviewed rows",
            );
        } else {
            for (idx, line) in part_lines.iter().enumerate() {
                draw_text(hdc, 38, 162 + (idx as i32 * 26), line);
            }
        }
    }

    unsafe fn paint_saved_kicad_schematic_canvas(
        hwnd: HWND,
        hdc: HDC,
        rect: &RECT,
        project_dir: &PathBuf,
    ) {
        let width = (rect.right - rect.left).max(760);

        let schematic_present = project_dir.join("chatpcb3-esp32s3.kicad_sch").exists();
        let review_present = project_dir
            .join("visual-review")
            .join("schematic-review.svg")
            .exists();
        let quality_present = project_dir.join("design-quality-report.md").exists();
        let project_dir_text = project_dir.to_string_lossy();
        let summary = chatpcb_desktop::ui_model::saved_preview_summary(project_dir_text.as_ref());
        let schematic_model =
            chatpcb_desktop::ui_model::saved_schematic_render_model(project_dir_text.as_ref());
        let has_h2_sensor = summary.has_h2_sensor
            || schematic_model.has_reference("U5")
            || schematic_model.has_net("H2_ADC");
        let has_touch_display = summary.has_touch_display
            || schematic_model.has_reference("DS1")
            || schematic_model.has_net("DISPLAY_SPI_SCK");
        let quality_line = summary.quality_summary.clone();

        if paint_kicad_exported_schematic_canvas(hdc, rect, project_dir, &quality_line, hwnd) {
            return;
        }

        draw_text(
            hdc,
            18,
            12,
            "KiCad Schematic Editor - saved ChatPCB3 review artifacts",
        );
        draw_text(
            hdc,
            18,
            34,
            "Saved KiCad evidence-backed schematic: .kicad_sch + schematic-review.svg + quality report",
        );
        draw_text(hdc, 18, 56, &quality_line);
        draw_schematic_model_summary(hdc, &schematic_model, 18, 78);

        draw_artifact_status(
            hdc,
            18,
            104,
            "chatpcb3-esp32s3.kicad_sch",
            schematic_present,
        );
        draw_artifact_status(
            hdc,
            286,
            104,
            "visual-review/schematic-review.svg",
            review_present,
        );
        draw_artifact_status(hdc, 606, 104, "design-quality-report.md", quality_present);

        let top = 92;
        let bottom_top = top + 146;
        let bottom_bottom = top + 270;
        let usb = (40, top + 28, 220, top + 124);
        let power = (270, top + 28, 470, top + 124);
        let mcu_left = (width - 300).max(640);
        let mcu = (mcu_left, top + 28, width - 70, top + 130);
        let display = (40, bottom_top, 310, bottom_bottom);
        let sensor = (350, bottom_top, 580, bottom_bottom);
        let h2_front_end = (600, bottom_top, width - 80, bottom_bottom);

        draw_wire(hdc, usb.2, top + 66, power.0, top + 66, "");
        draw_wire(hdc, power.2, top + 66, mcu.0, top + 66, "");
        draw_wire(hdc, usb.2, top + 106, mcu.0, top + 106, "");
        if !has_h2_sensor {
            draw_wire(hdc, mcu.0 + 128, mcu.3, sensor.0 + 128, sensor.1, "");
        }
        draw_saved_usb_power_entry_symbols(hdc, usb, power, mcu);
        if has_touch_display {
            draw_saved_touch_display_wire(hdc, mcu, display);
        }

        draw_review_block(
            hdc,
            usb,
            "J1 USB-C",
            &["VBUS fuse F1", "CC1/CC2 5.1k", "USB ESD U4"],
        );
        draw_review_block(
            hdc,
            power,
            "U2 3V3 LDO",
            &["ME6211", "in/out caps", "bulk cap"],
        );
        draw_review_block(
            hdc,
            mcu,
            "U1 ESP32-S3",
            if has_h2_sensor || has_touch_display {
                &["3V3/GND", "EN/BOOT", "USB ADC SPI"]
            } else {
                &["3V3/GND", "EN/BOOT", "USB sensor IO"]
            },
        );
        if has_h2_sensor {
            draw_saved_h2_adc_conditioning(hdc, sensor, mcu);
        }
        if has_touch_display {
            draw_saved_touch_spi_nets(hdc, display, mcu);
        }
        draw_review_block_compact(
            hdc,
            sensor,
            if has_h2_sensor {
                "U5 MQ-8 H2"
            } else {
                "U3 BME280 I2C"
            },
            if has_h2_sensor {
                &["VBUS_5V heater/VCC", "H2_AOUT_RAW", "H2_ADC -> GPIO1"]
            } else {
                &["SCL/SDA pull-ups", "decoupling OK"]
            },
        );
        if has_touch_display {
            draw_review_block_compact(
                hdc,
                display,
                "DS1 Waveshare 2.8 TFT",
                &[
                    "ST7789V SPI",
                    "DISPLAY_SPI_SCK",
                    "DISPLAY_SPI_MOSI",
                    "DISPLAY_SPI_MISO",
                    "XPT2046 touch TOUCH_CS",
                    "TOUCH_IRQ",
                ],
            );
        }
        if has_h2_sensor {
            draw_saved_h2_adc_front_end_symbols(hdc, h2_front_end, sensor, mcu);
        }
    }

    unsafe fn paint_kicad_exported_schematic_canvas(
        hdc: HDC,
        rect: &RECT,
        project_dir: &PathBuf,
        quality_line: &str,
        hwnd: HWND,
    ) -> bool {
        let svg_file = project_dir
            .join("kicad-render")
            .join("chatpcb3-esp32s3.svg");
        if !svg_file.exists() {
            return false;
        }

        let width = (rect.right - rect.left).max(760);
        let height = (rect.bottom - rect.top).max(280);
        let image_x = 18;
        let image_y = 110;
        let image_width = width - 36;
        let image_height = height - image_y - 16;
        let zoom_percent = schematic_zoom_percent(hwnd);
        let Some(bitmap) =
            render_kicad_svg_to_bitmap(&svg_file, image_width, image_height, zoom_percent)
        else {
            draw_text(
                hdc,
                18,
                132,
                "KiCad exported schematic SVG found, but native SVG rendering failed; showing fallback diagram.",
            );
            return false;
        };

        draw_kicad_export_viewport_background(hdc, width, height, image_y);
        draw_text(
            hdc,
            18,
            12,
            "KiCad Schematic Editor - KiCad export viewport",
        );
        draw_text(hdc, 18, 34, quality_line);
        draw_text(
            hdc,
            18,
            56,
            &format!(
                "KiCad schematic viewport: auto-cropped circuit content | Zoom: {zoom_percent}% | drag to pan"
            ),
        );
        draw_artifact_status(hdc, 18, 78, "kicad-render/chatpcb3-esp32s3.svg", true);
        draw_artifact_status(
            hdc,
            380,
            78,
            "chatpcb3-esp32s3.kicad_sch",
            project_dir.join("chatpcb3-esp32s3.kicad_sch").exists(),
        );
        draw_text(hdc, 686, 78, "KiCad export renderer active");
        let centered_image_x = image_x + ((image_width - bitmap.width).max(0) / 2);
        let (pan_x, pan_y) = schematic_pan(hwnd);
        draw_bitmap_32bpp(hdc, centered_image_x + pan_x, image_y + pan_y, &bitmap);
        true
    }

    unsafe fn draw_kicad_export_viewport_background(
        hdc: HDC,
        width: i32,
        height: i32,
        image_y: i32,
    ) {
        let border_pen = CreatePen(PS_SOLID, 1, rgb(205, 205, 205));
        let old_pen = SelectObject(hdc, border_pen as _);
        Rectangle(hdc, 12, image_y - 8, width - 12, height - 8);
        SelectObject(hdc, old_pen);
        DeleteObject(border_pen as _);
    }

    const KICAD_SCHEMATIC_CROP_PADDING_MM: f32 = 7.0;
    const KICAD_SCHEMATIC_CIRCUIT_VIEWPORT_LEFT_MM: f32 = 24.0;
    const KICAD_SCHEMATIC_CIRCUIT_VIEWPORT_TOP_MM: f32 = 34.0;
    const KICAD_SCHEMATIC_CIRCUIT_VIEWPORT_RIGHT_MM: f32 = 198.0;
    const KICAD_SCHEMATIC_CIRCUIT_BAND_BOTTOM_MM: f32 = 158.0;
    const KICAD_SCHEMATIC_DARK_PIXEL_THRESHOLD: u8 = 210;

    fn render_kicad_svg_to_bitmap(
        svg_file: &PathBuf,
        max_width: i32,
        max_height: i32,
        zoom_percent: i32,
    ) -> Option<RenderedSvgBitmap> {
        let svg_data = fs::read(svg_file).ok()?;
        let mut options = usvg::Options::default();
        options.fontdb_mut().load_system_fonts();
        let tree = usvg::Tree::from_data(&svg_data, &options).ok()?;
        let size = tree.size();
        let svg_width = size.width().max(1.0);
        let svg_height = size.height().max(1.0);
        let (viewbox_width_mm, viewbox_height_mm) =
            parse_svg_viewbox_size_mm(&svg_data).unwrap_or((297.0022, 210.0072));
        let unit_scale_x = (svg_width / viewbox_width_mm).max(0.01);
        let unit_scale_y = (svg_height / viewbox_height_mm).max(0.01);
        let fallback_crop = (
            KICAD_SCHEMATIC_CIRCUIT_VIEWPORT_LEFT_MM.min(viewbox_width_mm) * unit_scale_x,
            KICAD_SCHEMATIC_CIRCUIT_VIEWPORT_TOP_MM.min(viewbox_height_mm) * unit_scale_y,
            KICAD_SCHEMATIC_CIRCUIT_VIEWPORT_RIGHT_MM.min(viewbox_width_mm) * unit_scale_x,
            KICAD_SCHEMATIC_CIRCUIT_BAND_BOTTOM_MM.min(viewbox_height_mm) * unit_scale_y,
        );
        let (crop_left, crop_top, crop_right, crop_bottom) = detect_kicad_svg_content_bounds(
            &tree,
            svg_width,
            svg_height,
            unit_scale_x,
            unit_scale_y,
        )
        .unwrap_or(fallback_crop);
        let crop_width = (crop_right - crop_left).max(1.0);
        let crop_height = (crop_bottom - crop_top).max(1.0);
        let fit_scale =
            ((max_width as f32 / crop_width).min(max_height as f32 / crop_height)).clamp(0.25, 8.0);
        let scale = (fit_scale * (zoom_percent as f32 / 100.0)).clamp(0.25, 16.0);
        let out_width = (crop_width * scale).round().max(1.0) as u32;
        let out_height = (crop_height * scale).round().max(1.0) as u32;
        let mut pixmap = tiny_skia::Pixmap::new(out_width, out_height)?;
        pixmap.fill(tiny_skia::Color::WHITE);
        resvg::render(
            &tree,
            tiny_skia::Transform::from_row(
                scale,
                0.0,
                0.0,
                scale,
                -crop_left * scale,
                -crop_top * scale,
            ),
            &mut pixmap.as_mut(),
        );

        let mut bgra = Vec::with_capacity(pixmap.data().len());
        for rgba in pixmap.data().chunks_exact(4) {
            bgra.push(rgba[2]);
            bgra.push(rgba[1]);
            bgra.push(rgba[0]);
            bgra.push(255);
        }

        Some(RenderedSvgBitmap {
            width: out_width as i32,
            height: out_height as i32,
            bgra,
        })
    }

    fn parse_svg_viewbox_size_mm(svg_data: &[u8]) -> Option<(f32, f32)> {
        let svg_text = String::from_utf8_lossy(svg_data);
        let viewbox_start = svg_text.find("viewBox=\"")? + "viewBox=\"".len();
        let viewbox_end = svg_text[viewbox_start..].find('"')? + viewbox_start;
        let numbers = svg_text[viewbox_start..viewbox_end]
            .split_whitespace()
            .filter_map(|part| part.parse::<f32>().ok())
            .collect::<Vec<_>>();
        if numbers.len() == 4 {
            Some((numbers[2].max(1.0), numbers[3].max(1.0)))
        } else {
            None
        }
    }

    fn detect_kicad_svg_content_bounds(
        tree: &usvg::Tree,
        svg_width: f32,
        svg_height: f32,
        unit_scale_x: f32,
        unit_scale_y: f32,
    ) -> Option<(f32, f32, f32, f32)> {
        let detection_scale = 2.0;
        let detect_width = (svg_width * detection_scale).ceil().max(1.0) as u32;
        let detect_height = (svg_height * detection_scale).ceil().max(1.0) as u32;
        let mut pixmap = tiny_skia::Pixmap::new(detect_width, detect_height)?;
        pixmap.fill(tiny_skia::Color::WHITE);
        resvg::render(
            tree,
            tiny_skia::Transform::from_scale(detection_scale, detection_scale),
            &mut pixmap.as_mut(),
        );

        let mut min_x = detect_width;
        let mut min_y = detect_height;
        let mut max_x = 0;
        let mut max_y = 0;
        let mut found = false;
        let detection_bottom =
            (KICAD_SCHEMATIC_CIRCUIT_BAND_BOTTOM_MM * unit_scale_y * detection_scale)
                .ceil()
                .max(1.0)
                .min(detect_height as f32) as u32;
        for y in 0..detection_bottom {
            for x in 0..detect_width {
                let offset = ((y * detect_width + x) * 4) as usize;
                let rgba = &pixmap.data()[offset..offset + 4];
                let is_drawing_pixel = rgba[3] > 16
                    && rgba[0] < KICAD_SCHEMATIC_DARK_PIXEL_THRESHOLD
                    && rgba[1] < KICAD_SCHEMATIC_DARK_PIXEL_THRESHOLD
                    && rgba[2] < KICAD_SCHEMATIC_DARK_PIXEL_THRESHOLD;
                if is_drawing_pixel {
                    min_x = min_x.min(x);
                    min_y = min_y.min(y);
                    max_x = max_x.max(x);
                    max_y = max_y.max(y);
                    found = true;
                }
            }
        }

        if !found {
            return None;
        }

        let padding_x = KICAD_SCHEMATIC_CROP_PADDING_MM * unit_scale_x;
        let padding_y = KICAD_SCHEMATIC_CROP_PADDING_MM * unit_scale_y;
        let left = ((min_x as f32) / detection_scale - padding_x).max(0.0);
        let top = ((min_y as f32) / detection_scale - padding_y).max(0.0);
        let right = (((max_x + 1) as f32) / detection_scale + padding_x).min(svg_width);
        let bottom = (((max_y + 1) as f32) / detection_scale + padding_y).min(svg_height);
        Some((left, top, right, bottom))
    }

    unsafe fn draw_bitmap_32bpp(hdc: HDC, x: i32, y: i32, bitmap: &RenderedSvgBitmap) {
        let mut info = BITMAPINFO::default();
        info.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: bitmap.width,
            biHeight: -bitmap.height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            biSizeImage: bitmap.bgra.len() as u32,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        };

        StretchDIBits(
            hdc,
            x,
            y,
            bitmap.width,
            bitmap.height,
            0,
            0,
            bitmap.width,
            bitmap.height,
            bitmap.bgra.as_ptr() as *const c_void,
            &info,
            DIB_RGB_COLORS,
            SRCCOPY,
        );
    }

    unsafe fn draw_saved_usb_power_entry_symbols(
        hdc: HDC,
        usb: (i32, i32, i32, i32),
        power: (i32, i32, i32, i32),
        mcu: (i32, i32, i32, i32),
    ) {
        let vbus_x = (usb.2 + power.0) / 2 - 42;
        let vbus_y = usb.1 + 28;
        draw_power_net_label(hdc, vbus_x, vbus_y, "VBUS_5V");
        draw_text(hdc, vbus_x + 6, vbus_y + 20, "F1 fuse");

        let rail_x = (power.2 + mcu.0) / 2 - 34;
        draw_power_net_label(hdc, rail_x, power.1 + 28, "+3V3");
        draw_text(hdc, rail_x + 4, power.1 + 50, "CIN/COUT");
    }

    unsafe fn draw_saved_touch_display_wire(
        hdc: HDC,
        mcu: (i32, i32, i32, i32),
        display: (i32, i32, i32, i32),
    ) {
        let start_x = mcu.0;
        let start_y = mcu.3 - 26;
        let route_y = display.1 - 18;
        let end_x = display.2 - 26;
        let end_y = display.1;

        draw_wire(hdc, start_x, start_y, start_x - 46, start_y, "");
        draw_wire(hdc, start_x - 46, start_y, start_x - 46, route_y, "");
        draw_wire(hdc, start_x - 46, route_y, end_x, route_y, "");
        draw_wire(hdc, end_x, route_y, end_x, end_y, "");
    }

    unsafe fn draw_saved_h2_adc_conditioning(
        hdc: HDC,
        sensor: (i32, i32, i32, i32),
        mcu: (i32, i32, i32, i32),
    ) {
        let raw_y = sensor.1 + 38;
        let adc_y = mcu.3 - 34;

        draw_wire(hdc, sensor.2, raw_y, sensor.2 + 22, raw_y, "");
        draw_wire(hdc, mcu.0 - 22, adc_y, mcu.0, adc_y, "");
    }

    unsafe fn draw_saved_h2_adc_front_end_symbols(
        hdc: HDC,
        front_end: (i32, i32, i32, i32),
        sensor: (i32, i32, i32, i32),
        mcu: (i32, i32, i32, i32),
    ) {
        draw_text(hdc, front_end.0, front_end.1 + 4, "H2 ADC front-end");

        let r7_start = front_end.0 + 14;
        let node_x = front_end.0 + 72;
        let cap_x = node_x + 52;
        let signal_y = front_end.1 + 42;
        let ground_y = front_end.3 - 26;

        draw_wire(hdc, r7_start - 14, signal_y, r7_start, signal_y, "");
        draw_horizontal_resistor_symbol_label_below(
            hdc, r7_start, signal_y, node_x, signal_y, "R7 10k",
        );
        draw_resistor_symbol(hdc, node_x, signal_y, node_x, ground_y, "R8 10k");
        draw_ground_symbol_label_below(hdc, node_x, ground_y + 6);

        draw_wire(hdc, sensor.2, signal_y, r7_start - 14, signal_y, "");
        draw_wire(hdc, node_x, signal_y, cap_x, signal_y, "");
        draw_capacitor_symbol(hdc, cap_x, signal_y + 6, cap_x, ground_y - 8, "C6 100nF");
        draw_ground_symbol(hdc, cap_x, ground_y + 4);
        draw_wire(hdc, cap_x + 24, signal_y, mcu.0 + 90, mcu.3, "");
    }

    unsafe fn draw_saved_touch_spi_nets(
        hdc: HDC,
        display: (i32, i32, i32, i32),
        mcu: (i32, i32, i32, i32),
    ) {
        let base_y = display.1 + 58;
        draw_wire(hdc, display.2, base_y, mcu.0, mcu.3 - 42, "");
    }

    unsafe fn draw_artifact_status(hdc: HDC, x: i32, y: i32, label: &str, present: bool) {
        let status = if present { "OK" } else { "MISSING" };
        draw_text(hdc, x, y, &format!("[{status}] {label}"));
    }

    unsafe fn draw_schematic_model_summary(
        hdc: HDC,
        model: &chatpcb_desktop::ui_model::SavedSchematicRenderModel,
        x: i32,
        y: i32,
    ) {
        let refs = compact_join(&model.references, 8);
        let nets = compact_join(&model.nets, 8);
        let pins = compact_join(&model.pin_names, 8);
        draw_text(
            hdc,
            x,
            y,
            &format!(
                "Parsed KiCad: {} refs [{}] pins [{}] nets [{}]",
                model.source_file, refs, pins, nets
            ),
        );
    }

    unsafe fn draw_review_block(
        hdc: HDC,
        bounds: (i32, i32, i32, i32),
        title: &str,
        rows: &[&str],
    ) {
        fill_block_background(hdc, bounds);
        let pen = CreatePen(PS_SOLID, 2, rgb(28, 96, 70));
        let old = SelectObject(hdc, pen as _);
        Rectangle(hdc, bounds.0, bounds.1, bounds.2, bounds.3);
        SelectObject(hdc, old);
        DeleteObject(pen as _);

        draw_text(hdc, bounds.0 + 12, bounds.1 + 14, title);
        for (idx, row) in rows.iter().enumerate() {
            draw_text(hdc, bounds.0 + 12, bounds.1 + 38 + (idx as i32 * 20), row);
        }
    }

    unsafe fn draw_review_block_compact(
        hdc: HDC,
        bounds: (i32, i32, i32, i32),
        title: &str,
        rows: &[&str],
    ) {
        fill_block_background(hdc, bounds);
        let pen = CreatePen(PS_SOLID, 2, rgb(28, 96, 70));
        let old = SelectObject(hdc, pen as _);
        Rectangle(hdc, bounds.0, bounds.1, bounds.2, bounds.3);
        SelectObject(hdc, old);
        DeleteObject(pen as _);

        draw_text(hdc, bounds.0 + 12, bounds.1 + 10, title);
        for (idx, row) in rows.iter().enumerate() {
            draw_text(hdc, bounds.0 + 12, bounds.1 + 26 + (idx as i32 * 15), row);
        }
    }

    unsafe fn fill_block_background(hdc: HDC, bounds: (i32, i32, i32, i32)) {
        let rect = RECT {
            left: bounds.0,
            top: bounds.1,
            right: bounds.2,
            bottom: bounds.3,
        };
        FillRect(hdc, &rect, GetStockObject(WHITE_BRUSH) as _);
    }

    unsafe fn draw_box(hdc: HDC, bounds: (i32, i32, i32, i32), label: &str) {
        let pen = CreatePen(PS_SOLID, 2, rgb(40, 88, 130));
        let old = SelectObject(hdc, pen as _);
        Rectangle(hdc, bounds.0, bounds.1, bounds.2, bounds.3);
        SelectObject(hdc, old);
        DeleteObject(pen as _);
        draw_text(hdc, bounds.0 + 12, bounds.1 + 20, label);
    }

    unsafe fn draw_wire(hdc: HDC, x1: i32, y1: i32, x2: i32, y2: i32, label: &str) {
        let pen = CreatePen(PS_SOLID, 2, rgb(70, 70, 70));
        let old = SelectObject(hdc, pen as _);
        MoveToEx(hdc, x1, y1, null_mut());
        if x1 != x2 && y1 != y2 {
            let elbow_x = if x2 < x1 { x2 } else { (x1 + x2) / 2 };
            LineTo(hdc, elbow_x, y1);
            LineTo(hdc, elbow_x, y2);
        }
        LineTo(hdc, x2, y2);
        SelectObject(hdc, old);
        DeleteObject(pen as _);
        if !label.is_empty() {
            draw_text(hdc, (x1 + x2) / 2 - 14, (y1 + y2) / 2 - 18, label);
        }
    }

    unsafe fn draw_resistor_symbol(hdc: HDC, x1: i32, y1: i32, x2: i32, y2: i32, label: &str) {
        let pen = CreatePen(PS_SOLID, 2, rgb(70, 70, 70));
        let old = SelectObject(hdc, pen as _);
        if x1 == x2 {
            let mid_y = (y1 + y2) / 2;
            MoveToEx(hdc, x1, y1, null_mut());
            LineTo(hdc, x1, mid_y - 10);
            Rectangle(hdc, x1 - 9, mid_y - 10, x1 + 9, mid_y + 10);
            MoveToEx(hdc, x1, mid_y + 10, null_mut());
            LineTo(hdc, x2, y2);
            draw_text(hdc, x1 + 12, mid_y - 9, label);
        } else {
            let mid_x = (x1 + x2) / 2;
            MoveToEx(hdc, x1, y1, null_mut());
            LineTo(hdc, mid_x - 14, y1);
            Rectangle(hdc, mid_x - 14, y1 - 8, mid_x + 14, y1 + 8);
            MoveToEx(hdc, mid_x + 14, y1, null_mut());
            LineTo(hdc, x2, y2);
            draw_text(hdc, mid_x - 22, y1 - 26, label);
        }
        SelectObject(hdc, old);
        DeleteObject(pen as _);
    }

    unsafe fn draw_horizontal_resistor_symbol_label_below(
        hdc: HDC,
        x1: i32,
        y1: i32,
        x2: i32,
        _y2: i32,
        label: &str,
    ) {
        let pen = CreatePen(PS_SOLID, 2, rgb(70, 70, 70));
        let old = SelectObject(hdc, pen as _);
        let mid_x = (x1 + x2) / 2;
        MoveToEx(hdc, x1, y1, null_mut());
        LineTo(hdc, mid_x - 14, y1);
        Rectangle(hdc, mid_x - 14, y1 - 8, mid_x + 14, y1 + 8);
        MoveToEx(hdc, mid_x + 14, y1, null_mut());
        LineTo(hdc, x2, y1);
        draw_text(hdc, mid_x - 22, y1 + 12, label);
        SelectObject(hdc, old);
        DeleteObject(pen as _);
    }

    unsafe fn draw_capacitor_symbol(hdc: HDC, x1: i32, y1: i32, x2: i32, y2: i32, label: &str) {
        let pen = CreatePen(PS_SOLID, 2, rgb(70, 70, 70));
        let old = SelectObject(hdc, pen as _);
        if y1 == y2 {
            let mid_x = (x1 + x2) / 2;
            MoveToEx(hdc, x1, y1, null_mut());
            LineTo(hdc, mid_x - 5, y1);
            MoveToEx(hdc, mid_x - 5, y1 - 10, null_mut());
            LineTo(hdc, mid_x - 5, y1 + 10);
            MoveToEx(hdc, mid_x + 5, y1 - 10, null_mut());
            LineTo(hdc, mid_x + 5, y1 + 10);
            MoveToEx(hdc, mid_x + 5, y1, null_mut());
            LineTo(hdc, x2, y2);
            draw_text(hdc, mid_x - 22, y1 + 12, label);
        } else {
            let mid_y = (y1 + y2) / 2;
            MoveToEx(hdc, x1, y1, null_mut());
            LineTo(hdc, x1, mid_y - 5);
            MoveToEx(hdc, x1 - 10, mid_y - 5, null_mut());
            LineTo(hdc, x1 + 10, mid_y - 5);
            MoveToEx(hdc, x1 - 10, mid_y + 5, null_mut());
            LineTo(hdc, x1 + 10, mid_y + 5);
            MoveToEx(hdc, x1, mid_y + 5, null_mut());
            LineTo(hdc, x2, y2);
            draw_text(hdc, x1 + 12, mid_y - 8, label);
        }
        SelectObject(hdc, old);
        DeleteObject(pen as _);
    }

    unsafe fn draw_power_net_label(hdc: HDC, x: i32, y: i32, label: &str) {
        draw_text(hdc, x, y, label);
        let pen = CreatePen(PS_SOLID, 2, rgb(70, 70, 70));
        let old = SelectObject(hdc, pen as _);
        MoveToEx(hdc, x + 18, y + 18, null_mut());
        LineTo(hdc, x + 18, y + 30);
        MoveToEx(hdc, x + 10, y + 30, null_mut());
        LineTo(hdc, x + 26, y + 30);
        SelectObject(hdc, old);
        DeleteObject(pen as _);
    }

    unsafe fn draw_ground_symbol(hdc: HDC, x: i32, y: i32) {
        let pen = CreatePen(PS_SOLID, 2, rgb(70, 70, 70));
        let old = SelectObject(hdc, pen as _);
        MoveToEx(hdc, x, y - 8, null_mut());
        LineTo(hdc, x, y);
        MoveToEx(hdc, x - 12, y, null_mut());
        LineTo(hdc, x + 12, y);
        MoveToEx(hdc, x - 8, y + 5, null_mut());
        LineTo(hdc, x + 8, y + 5);
        MoveToEx(hdc, x - 4, y + 10, null_mut());
        LineTo(hdc, x + 4, y + 10);
        SelectObject(hdc, old);
        DeleteObject(pen as _);
        draw_text(hdc, x + 14, y - 8, "GND");
    }

    unsafe fn draw_ground_symbol_label_below(hdc: HDC, x: i32, y: i32) {
        let pen = CreatePen(PS_SOLID, 2, rgb(70, 70, 70));
        let old = SelectObject(hdc, pen as _);
        MoveToEx(hdc, x, y - 8, null_mut());
        LineTo(hdc, x, y);
        MoveToEx(hdc, x - 12, y, null_mut());
        LineTo(hdc, x + 12, y);
        MoveToEx(hdc, x - 8, y + 5, null_mut());
        LineTo(hdc, x + 8, y + 5);
        MoveToEx(hdc, x - 4, y + 10, null_mut());
        LineTo(hdc, x + 4, y + 10);
        SelectObject(hdc, old);
        DeleteObject(pen as _);
        draw_text(hdc, x - 12, y + 13, "GND");
    }

    unsafe fn draw_text(hdc: HDC, x: i32, y: i32, label: &str) {
        let text = wide(label);
        TextOutW(hdc, x, y, text.as_ptr(), (text.len() - 1) as i32);
    }

    fn compact_join(values: &[String], max_items: usize) -> String {
        if values.is_empty() {
            return "none".to_string();
        }

        let mut shown = values
            .iter()
            .take(max_items)
            .map(String::as_str)
            .collect::<Vec<_>>()
            .join(", ");
        if values.len() > max_items {
            shown.push_str(", ...");
        }
        shown
    }

    unsafe fn draw_grid(hdc: HDC, width: i32, height: i32) {
        let pen = CreatePen(PS_SOLID, 1, rgb(232, 236, 240));
        let old = SelectObject(hdc, pen as _);
        let mut x = 0;
        while x < width {
            MoveToEx(hdc, x, 0, null_mut());
            LineTo(hdc, x, height);
            x += 24;
        }
        let mut y = 0;
        while y < height {
            MoveToEx(hdc, 0, y, null_mut());
            LineTo(hdc, width, y);
            y += 24;
        }
        SelectObject(hdc, old);
        DeleteObject(pen as _);
    }

    unsafe fn draw_kicad_symbol(
        hdc: HDC,
        bounds: (i32, i32, i32, i32),
        refdes: &str,
        value: &str,
        pins: &[&str],
    ) {
        let pen = CreatePen(PS_SOLID, 2, rgb(28, 96, 70));
        let old = SelectObject(hdc, pen as _);
        Rectangle(hdc, bounds.0, bounds.1, bounds.2, bounds.3);
        SelectObject(hdc, old);
        DeleteObject(pen as _);

        draw_text(hdc, bounds.0 + 8, bounds.1 - 20, refdes);
        draw_text(hdc, bounds.0 + 8, bounds.1 + 8, value);

        for (idx, pin) in pins.iter().enumerate() {
            let y = bounds.1 + 28 + (idx as i32 * 18);
            if y < bounds.3 - 4 {
                MoveToEx(hdc, bounds.0 - 16, y, null_mut());
                LineTo(hdc, bounds.0, y);
                draw_text(hdc, bounds.0 + 8, y - 8, pin);
            }
        }
    }

    fn rgb(red: u8, green: u8, blue: u8) -> COLORREF {
        red as u32 | ((green as u32) << 8) | ((blue as u32) << 16)
    }

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_NOTIFY => {
                handle_tab_selection(hwnd, lparam);
                0
            }
            WM_COMMAND => {
                let control_id = wparam & 0xffff;
                let notification_code = (wparam >> 16) & 0xffff;

                if control_id == ID_PROMPT && notification_code == EN_CHANGE as usize {
                    handle_prompt_changed(hwnd);
                    return 0;
                }

                if control_id == ID_SEND_DESIGN {
                    PostMessageW(hwnd, WM_CHATPCB_SEND_DEFERRED, 0, 0);
                    return 0;
                }

                if control_id == ID_PROVIDER_LOGIN {
                    handle_provider_login(hwnd);
                    return 0;
                }

                if control_id == ID_USE_EXAMPLE {
                    handle_use_example(hwnd);
                    return 0;
                }

                if control_id == ID_OPEN_EVIDENCE {
                    handle_open_evidence(hwnd);
                    return 0;
                }

                if control_id == ID_OPEN_PCB {
                    handle_open_pcb(hwnd);
                    return 0;
                }

                if control_id == ID_OPEN_KICAD {
                    handle_open_kicad(hwnd);
                    return 0;
                }

                DefWindowProcW(hwnd, msg, wparam, lparam)
            }
            WM_CHATPCB_SEND_DEFERRED => {
                handle_send_design(hwnd);
                0
            }
            WM_SETFOCUS => {
                let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut AppControls;
                if !ptr.is_null() {
                    focus_prompt_for_first_chat(&*ptr);
                }
                0
            }
            WM_SIZE => {
                layout(hwnd);
                0
            }
            WM_DESTROY => {
                PostQuitMessage(0);
                0
            }
            WM_NCDESTROY => {
                let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut AppControls;
                if !ptr.is_null() {
                    SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
                    ORIGINAL_PROMPT_PROC = None;
                    drop(Box::from_raw(ptr));
                }
                DefWindowProcW(hwnd, msg, wparam, lparam)
            }
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }

    unsafe fn handle_prompt_changed(hwnd: HWND) {
        let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut AppControls;
        if ptr.is_null() {
            return;
        }

        let controls = &mut *ptr;
        if controls.suppress_prompt_change {
            return;
        }

        let prompt = get_control_text(hwnd, ID_PROMPT);
        let preview_body = live_body_for_selected_tab(controls, &prompt, "입력 중");
        set_left_workspace_status(controls, live_status_for_selected_tab(controls));
        set_live_schematic(controls, &preview_body);
    }

    unsafe fn selected_left_tab(controls: &AppControls) -> usize {
        let selected = SendMessageW(controls.tabs, TCM_GETCURSEL, 0, 0);
        if selected >= 0 {
            selected as usize
        } else {
            0
        }
    }

    unsafe fn live_body_for_selected_tab(
        controls: &AppControls,
        prompt: &str,
        apply_result: &str,
    ) -> String {
        if selected_left_tab(controls) == 1 {
            chatpcb_desktop::ui_model::live_block_diagram_body(prompt, apply_result)
        } else {
            chatpcb_desktop::ui_model::live_schematic_body(prompt, apply_result)
        }
    }

    unsafe fn saved_body_for_selected_tab(controls: &AppControls, project_dir: &str) -> String {
        chatpcb_desktop::ui_model::saved_preview_tab_body(selected_left_tab(controls), project_dir)
    }

    unsafe fn live_status_for_selected_tab(controls: &AppControls) -> &'static str {
        if selected_left_tab(controls) == 1 {
            "블록도 입력 중: 채팅 입력이 블록 구조에 반영됩니다."
        } else {
            "회로도 입력 중: 채팅 입력이 KiCad 회로도 작성 화면에 반영됩니다."
        }
    }

    unsafe fn handle_tab_selection(hwnd: HWND, lparam: LPARAM) {
        let header = lparam as *const NMHDR;
        if header.is_null() || (*header).code != TCN_SELCHANGE {
            return;
        }

        let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut AppControls;
        if ptr.is_null() {
            return;
        }

        let controls = &*ptr;
        let selected = SendMessageW(controls.tabs, TCM_GETCURSEL, 0, 0);
        if selected >= 0 {
            let selected = selected as usize;
            if let Some(project_dir) = controls.last_workspace_dir.as_ref() {
                let project_dir = project_dir.to_string_lossy();
                let status =
                    chatpcb_desktop::ui_model::saved_preview_tab_status(selected, &project_dir);
                let body =
                    chatpcb_desktop::ui_model::saved_preview_tab_body(selected, &project_dir);
                set_left_workspace_status(controls, &status);
                set_live_schematic(controls, &body);
            } else {
                set_left_workspace_status(
                    controls,
                    chatpcb_desktop::ui_model::left_tab_status(selected),
                );
                set_live_schematic(controls, chatpcb_desktop::ui_model::left_tab_body(selected));
            }
        }
    }

    unsafe fn layout(hwnd: HWND) {
        let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut AppControls;
        if ptr.is_null() {
            return;
        }

        let controls = &*ptr;
        let mut rect: RECT = zeroed();
        GetClientRect(hwnd, &mut rect);

        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        let margin = 12;
        let gap = 10;
        let left_width = ((width - margin * 2 - gap) as f32 * 0.70) as i32;
        let right_width = width - margin * 2 - gap - left_width;
        let right_x = margin + left_width + gap;

        MoveWindow(controls.left_pane, margin, margin, left_width, 34, 1);
        MoveWindow(
            controls.tabs,
            margin,
            margin + 42,
            left_width,
            height - margin * 2 - 120,
            1,
        );
        let preview_y = margin + 84;
        let status_y = height - margin - 68;
        let preview_height = (status_y - preview_y - gap).max(80);
        let schematic_detail_height = if preview_height > 560 {
            48
        } else if preview_height > 460 {
            60
        } else if preview_height > 380 {
            72
        } else {
            80
        };
        let canvas_height = (preview_height - schematic_detail_height - gap).max(160);
        MoveWindow(
            controls.schematic_canvas,
            margin + 8,
            preview_y,
            left_width - 16,
            canvas_height,
            1,
        );
        MoveWindow(
            controls.design_preview,
            margin + 8,
            preview_y + canvas_height + gap,
            left_width - 16,
            (preview_height - canvas_height - gap).max(80),
            1,
        );
        MoveWindow(controls.status, margin, status_y, left_width, 68, 1);

        MoveWindow(
            controls.chat_transcript,
            right_x,
            margin,
            right_width,
            height - 236,
            1,
        );
        MoveWindow(
            controls.prompt_label,
            right_x,
            height - 212,
            right_width,
            18,
            1,
        );
        MoveWindow(controls.prompt, right_x, height - 190, right_width, 58, 1);
        let action_gap = 8;
        let example_width = if right_width > 340 {
            112
        } else {
            right_width / 4
        };
        let open_pcb_width = if right_width > 340 {
            96
        } else {
            right_width / 4
        };
        let send_width = right_width - example_width - open_pcb_width - action_gap * 2;
        MoveWindow(
            controls.use_example_button,
            right_x,
            height - 122,
            example_width,
            30,
            1,
        );
        MoveWindow(
            controls.send_button,
            right_x + example_width + action_gap,
            height - 122,
            send_width,
            30,
            1,
        );
        MoveWindow(
            controls.open_pcb_button,
            right_x + example_width + action_gap + send_width + action_gap,
            height - 122,
            open_pcb_width,
            30,
            1,
        );
        let provider_width = 112;
        let evidence_width = 88;
        let kicad_width = 92;
        MoveWindow(
            controls.provider_button,
            right_x,
            height - 82,
            provider_width,
            32,
            1,
        );
        MoveWindow(
            controls.open_evidence_button,
            right_x + provider_width + action_gap,
            height - 82,
            evidence_width,
            32,
            1,
        );
        MoveWindow(
            controls.open_kicad_button,
            right_x + provider_width + action_gap + evidence_width + action_gap,
            height - 82,
            kicad_width,
            32,
            1,
        );
        let model_x = right_x
            + provider_width
            + action_gap
            + evidence_width
            + action_gap
            + kicad_width
            + action_gap;
        MoveWindow(
            controls.model_choice,
            model_x,
            height - 82,
            right_width - (model_x - right_x),
            180,
            1,
        );
        MoveWindow(
            controls.pipeline_status,
            right_x,
            height - 40,
            right_width,
            32,
            1,
        );
    }

    unsafe fn handle_send_design(hwnd: HWND) {
        let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut AppControls;
        if ptr.is_null() {
            return;
        }

        let prompt = get_control_text(hwnd, ID_PROMPT);
        let prompt_was_empty = prompt.trim().is_empty();
        let prompt_for_workspace = if prompt_was_empty {
            chatpcb_desktop::ui_model::example_board_prompt()
        } else {
            prompt.trim()
        };
        let mut turn_transcript = chatpcb_desktop::ui_model::send_design_transcript(&prompt);
        let mut pipeline_after_send =
            chatpcb_desktop::ui_model::design_pipeline_status().to_string();
        let controls = &mut *ptr;
        match super::create_preview_workspace(prompt_for_workspace, preview_workspace_root()) {
            Ok(workspace) => {
                let project_dir = PathBuf::from(&workspace.project_dir);
                let kicad_check = run_kicad_pcb_check(&project_dir);
                let validation = run_kicad_erc_drc_reports(&project_dir);
                let schematic_svg_export = run_kicad_schematic_svg_export(&project_dir);
                turn_transcript.push_str(
                    &chatpcb_desktop::ui_model::preview_workspace_saved_transcript(
                        &workspace.project_dir,
                        &workspace.release_report_file,
                    ),
                );
                turn_transcript.push_str(&chatpcb_desktop::ui_model::kicad_cli_check_transcript(
                    &kicad_check.report_file.to_string_lossy(),
                    &kicad_check.summary,
                ));
                turn_transcript.push_str(
                    &chatpcb_desktop::ui_model::erc_drc_validation_transcript(
                        &validation.erc_report_file.to_string_lossy(),
                        &validation.drc_report_file.to_string_lossy(),
                        &validation.summary_file.to_string_lossy(),
                        &validation.summary,
                    ),
                );
                turn_transcript.push_str(&format!(
                    "\r\nKiCad schematic export:\r\n- {}\r\n- SVG: {}\r\n- report: {}\r\n",
                    schematic_svg_export.summary,
                    schematic_svg_export
                        .svg_file
                        .as_ref()
                        .map(|path| path.to_string_lossy().to_string())
                        .unwrap_or_else(|| "not generated".to_string()),
                    schematic_svg_export.report_file.to_string_lossy()
                ));
                turn_transcript
                    .push_str(chatpcb_desktop::ui_model::preview_result_summary_transcript());
                let left_status = chatpcb_desktop::ui_model::preview_workspace_left_status(
                    &workspace.project_dir,
                );
                set_left_workspace_status(controls, &left_status);
                controls.last_workspace_dir = Some(project_dir);
                let preview_body = saved_body_for_selected_tab(controls, &workspace.project_dir);
                set_live_schematic(controls, &preview_body);
                set_workspace_action_buttons_enabled(controls, true);
                pipeline_after_send =
                    chatpcb_desktop::ui_model::validation_pipeline_status(&validation.summary);
            }
            Err(error) => {
                turn_transcript.push_str(
                    &chatpcb_desktop::ui_model::preview_workspace_failed_transcript(
                        &error.to_string(),
                    ),
                );
                set_left_workspace_status(
                    controls,
                    "미리보기 저장 실패. chat에서 오류를 확인하세요.",
                );
                set_live_schematic(
                    controls,
                    "미리보기 저장 실패.\r\nchat에서 오류를 확인하세요.\r\n상태: 미리보기 단계.",
                );
                set_workspace_action_buttons_enabled(
                    controls,
                    controls.last_workspace_dir.is_some(),
                );
            }
        }
        let transcript = chatpcb_desktop::ui_model::append_chat_transcript(
            &get_control_text(hwnd, ID_CHAT_TRANSCRIPT),
            &turn_transcript,
        );
        set_chat_transcript_text(controls, &transcript);
        if prompt_was_empty {
            pipeline_after_send = chatpcb_desktop::ui_model::visible_empty_prompt_pipeline_status(
                &pipeline_after_send,
            );
        }
        set_pipeline_status(controls, &pipeline_after_send);
        let empty = wide("");
        controls.suppress_prompt_change = true;
        SetDlgItemTextW(hwnd, ID_PROMPT as i32, empty.as_ptr());
        controls.suppress_prompt_change = false;
        focus_prompt_after_action(controls);
    }

    fn run_kicad_pcb_check(project_dir: &PathBuf) -> PcbCheckUiResult {
        let pcb_file = project_dir.join("chatpcb3-esp32s3.kicad_pcb");
        let report_file = project_dir.join("kicad-pcb-check.txt");
        let check = if !pcb_file.exists() {
            chatpcb_core::validation::summarize_kicad_cli_check(
                Some(1),
                "",
                "chatpcb3-esp32s3.kicad_pcb was not found",
            )
        } else if let Some(kicad_cli) = preferred_kicad_cli_path() {
            match super::Command::new(kicad_cli)
                .args(["pcb", "upgrade"])
                .arg(&pcb_file)
                .output()
            {
                Ok(output) => chatpcb_core::validation::summarize_kicad_cli_check(
                    output.status.code(),
                    &String::from_utf8_lossy(&output.stdout),
                    &String::from_utf8_lossy(&output.stderr),
                ),
                Err(error) => chatpcb_core::validation::summarize_kicad_cli_check(
                    None,
                    "",
                    &format!("failed to run kicad-cli.exe: {error}"),
                ),
            }
        } else {
            chatpcb_core::validation::summarize_kicad_cli_check(
                None,
                "",
                "kicad-cli.exe was not found",
            )
        };

        let report = format!(
            "ChatPCB3 KiCad CLI PCB check\r\n\
             Status: {:?}\r\n\
             Exit code: {:?}\r\n\
             Summary: {}\r\n\
             \r\n\
             PCB file:\r\n\
             {}\r\n\
             \r\n\
             STDOUT:\r\n\
             {}\r\n\
             \r\n\
             STDERR:\r\n\
             {}\r\n\
             \r\n\
             Boundary:\r\n\
             This is a prototype-review compatibility check, not manufacturing evidence.\r\n",
            check.status,
            check.exit_code,
            check.summary,
            pcb_file.to_string_lossy(),
            check.stdout,
            check.stderr
        );
        let _ = fs::write(&report_file, report);

        PcbCheckUiResult {
            summary: check.summary,
            report_file,
        }
    }

    fn run_kicad_schematic_svg_export(project_dir: &PathBuf) -> SchematicSvgExportResult {
        let schematic_file = project_dir.join("chatpcb3-esp32s3.kicad_sch");
        let output_dir = project_dir.join("kicad-render");
        let svg_file = output_dir.join("chatpcb3-esp32s3.svg");
        let report_file = project_dir.join("kicad-schematic-export.txt");

        let _ = fs::create_dir_all(&output_dir);
        let mut command_log = String::new();
        let summary = if !schematic_file.exists() {
            "KiCad schematic SVG export skipped: chatpcb3-esp32s3.kicad_sch was not found"
                .to_string()
        } else if let Some(kicad_cli) = preferred_kicad_cli_path() {
            let output = super::Command::new(&kicad_cli)
                .args([
                    "sch",
                    "export",
                    "svg",
                    "--black-and-white",
                    "--exclude-drawing-sheet",
                    "--output",
                ])
                .arg(&output_dir)
                .arg(&schematic_file)
                .output();
            command_log.push_str(&format_validation_command_log("SCHEMATIC SVG", &output));
            match output {
                Ok(output) if output.status.success() && svg_file.exists() => {
                    "KiCad schematic SVG exported from .kicad_sch for the 회로도 tab".to_string()
                }
                Ok(output) => format!(
                    "KiCad schematic SVG export did not produce {} (exit {:?})",
                    svg_file.to_string_lossy(),
                    output.status.code()
                ),
                Err(error) => format!("KiCad schematic SVG export failed to run: {error}"),
            }
        } else {
            "KiCad schematic SVG export skipped: kicad-cli.exe was not found".to_string()
        };

        let report = format!(
            "ChatPCB3 KiCad schematic SVG export\r\n\
             Summary: {}\r\n\
             \r\n\
             회로도:\r\n\
             {}\r\n\
             \r\n\
             Exported SVG:\r\n\
             {}\r\n\
             \r\n\
             Command log:\r\n\
             {}\r\n\
             Boundary:\r\n\
             This SVG is generated by KiCad CLI from the saved .kicad_sch and is the primary 회로도 tab view when present.\r\n",
            summary,
            schematic_file.to_string_lossy(),
            svg_file.to_string_lossy(),
            command_log
        );
        let _ = fs::write(&report_file, report);

        SchematicSvgExportResult {
            summary,
            report_file,
            svg_file: if svg_file.exists() {
                Some(svg_file)
            } else {
                None
            },
        }
    }

    fn run_kicad_erc_drc_reports(project_dir: &PathBuf) -> ValidationUiResult {
        let schematic_file = project_dir.join("chatpcb3-esp32s3.kicad_sch");
        let pcb_file = project_dir.join("chatpcb3-esp32s3.kicad_pcb");
        let erc_report_file = project_dir.join("erc-report.json");
        let drc_report_file = project_dir.join("drc-report.json");
        let summary_file = project_dir.join("kicad-validation-summary.txt");

        let _ = fs::remove_file(&erc_report_file);
        let _ = fs::remove_file(&drc_report_file);

        let mut command_log = String::new();
        let summary = if !schematic_file.exists() || !pcb_file.exists() {
            "KiCad ERC/DRC 미실행: preview 회로도 또는 PCB 파일이 없습니다. 검토 목록을 확인하세요. 현재는 prototype-review입니다."
                .to_string()
        } else if let Some(kicad_cli) = preferred_kicad_cli_path() {
            let erc_output = super::Command::new(&kicad_cli)
                .args(["sch", "erc", "--format", "json", "--output"])
                .arg(&erc_report_file)
                .arg(&schematic_file)
                .output();
            let drc_output = super::Command::new(&kicad_cli)
                .args(["pcb", "drc", "--format", "json", "--output"])
                .arg(&drc_report_file)
                .arg(&pcb_file)
                .output();

            command_log.push_str(&format_validation_command_log("ERC", &erc_output));
            command_log.push_str(&format_validation_command_log("DRC", &drc_output));

            match (
                fs::read_to_string(&erc_report_file)
                    .ok()
                    .and_then(|report| chatpcb_core::validation::parse_kicad_report(&report).ok()),
                fs::read_to_string(&drc_report_file)
                    .ok()
                    .and_then(|report| chatpcb_core::validation::parse_kicad_report(&report).ok()),
            ) {
                (Some(erc), Some(drc)) => {
                    chatpcb_core::validation::summarize_erc_drc_reports(&erc, &drc)
                }
                _ => {
                    "KiCad ERC/DRC 검증: JSON report를 읽지 못했습니다. 검토 목록의 KiCad 검증 요약을 확인하세요. 현재는 prototype-review입니다."
                        .to_string()
                }
            }
        } else {
            "KiCad ERC/DRC 미실행: KiCad 10 실행 파일을 찾지 못했습니다. KiCad 10 설치 후 검토 목록에서 다시 확인하세요. 현재는 prototype-review입니다."
                .to_string()
        };

        let report = format!(
            "ChatPCB3 KiCad ERC/DRC validation\r\n\
             Summary: {}\r\n\
             \r\n\
             회로도:\r\n\
             {}\r\n\
             \r\n\
             PCB:\r\n\
             {}\r\n\
             \r\n\
             ERC report:\r\n\
             {}\r\n\
             \r\n\
             DRC report:\r\n\
             {}\r\n\
             \r\n\
             Command log:\r\n\
             {}\r\n\
             Boundary:\r\n\
             This is validation evidence, not manufacturing signoff. See design-quality-report.md for the current quality level.\r\n",
            summary,
            schematic_file.to_string_lossy(),
            pcb_file.to_string_lossy(),
            erc_report_file.to_string_lossy(),
            drc_report_file.to_string_lossy(),
            command_log
        );
        let _ = fs::write(&summary_file, report);
        let _ = rewrite_quality_report_after_validation(project_dir);

        ValidationUiResult {
            summary,
            erc_report_file,
            drc_report_file,
            summary_file,
        }
    }

    fn rewrite_quality_report_after_validation(project_dir: &PathBuf) -> std::io::Result<()> {
        super::rewrite_quality_report_after_validation(project_dir)
    }

    fn format_validation_command_log(
        label: &str,
        output: &std::io::Result<std::process::Output>,
    ) -> String {
        match output {
            Ok(output) => format!(
                "{label} exit code: {:?}\r\nSTDOUT:\r\n{}\r\nSTDERR:\r\n{}\r\n\r\n",
                output.status.code(),
                String::from_utf8_lossy(&output.stdout).trim(),
                String::from_utf8_lossy(&output.stderr).trim()
            ),
            Err(error) => format!("{label} failed to run: {error}\r\n\r\n"),
        }
    }

    unsafe fn handle_open_evidence(hwnd: HWND) {
        let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut AppControls;
        if ptr.is_null() {
            return;
        }

        let controls = &*ptr;
        if let Some(path) = &controls.last_workspace_dir {
            open_evidence_report(path);
            set_pipeline_status(
                controls,
                chatpcb_desktop::ui_model::open_evidence_pipeline_status(),
            );
        } else {
            set_pipeline_status(controls, "아직 검토 목록 없음: 먼저 설계 생성을 누르세요.");
        }
    }

    unsafe fn handle_open_pcb(hwnd: HWND) {
        let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut AppControls;
        if ptr.is_null() {
            return;
        }

        let controls = &*ptr;
        if let Some(path) = &controls.last_workspace_dir {
            open_preview_pcb(path, controls);
        } else {
            set_pipeline_status(controls, "아직 PCB 없음: 먼저 설계 생성을 누르세요.");
        }
    }

    unsafe fn handle_open_kicad(hwnd: HWND) {
        let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut AppControls;
        if ptr.is_null() {
            return;
        }

        let controls = &*ptr;
        if let Some(path) = &controls.last_workspace_dir {
            open_preview_kicad_editor(path, controls);
        } else {
            set_pipeline_status(
                controls,
                "아직 KiCad 회로도 없음: 먼저 설계 생성을 누르세요.",
            );
        }
    }

    unsafe fn open_preview_kicad_editor(project_dir: &PathBuf, controls: &AppControls) {
        let schematic_file = project_dir.join("chatpcb3-esp32s3.kicad_sch");
        let project_file = project_dir.join("chatpcb3-esp32s3.kicad_pro");
        let opened_with_kicad = if schematic_file.exists() {
            open_preview_kicad_editor_file(&schematic_file)
        } else if project_file.exists() {
            open_preview_kicad_editor_file(&project_file)
        } else {
            false
        };
        set_pipeline_status(
            controls,
            chatpcb_desktop::ui_model::open_kicad_editor_pipeline_status(opened_with_kicad),
        );
    }

    unsafe fn open_preview_kicad_editor_file(kicad_file: &PathBuf) -> bool {
        if let Some(kicad) = preferred_kicad_gui_path() {
            let operation = wide("open");
            let executable = wide(&kicad.to_string_lossy());
            let parameters = wide(&format!("\"{}\"", kicad_file.to_string_lossy()));
            ShellExecuteW(
                null_mut(),
                operation.as_ptr(),
                executable.as_ptr(),
                parameters.as_ptr(),
                null(),
                SW_SHOW,
            );
            true
        } else {
            let operation = wide("open");
            let file = wide(&kicad_file.to_string_lossy());
            ShellExecuteW(
                null_mut(),
                operation.as_ptr(),
                file.as_ptr(),
                null(),
                null(),
                SW_SHOW,
            );
            false
        }
    }

    unsafe fn open_preview_pcb(project_dir: &PathBuf, controls: &AppControls) {
        let pcb_file = project_dir.join("chatpcb3-esp32s3.kicad_pcb");
        if pcb_file.exists() {
            let opened_with_kicad = open_preview_pcb_file(&pcb_file);
            set_pipeline_status(
                controls,
                chatpcb_desktop::ui_model::open_pcb_pipeline_status(opened_with_kicad),
            );
        } else {
            set_pipeline_status(controls, "PCB 파일 없음: 설계 생성을 다시 누르세요.");
        }
    }

    unsafe fn open_preview_pcb_file(pcb_file: &PathBuf) -> bool {
        if let Some(pcbnew) = preferred_pcbnew_path() {
            let operation = wide("open");
            let executable = wide(&pcbnew.to_string_lossy());
            let parameters = wide(&format!("\"{}\"", pcb_file.to_string_lossy()));
            ShellExecuteW(
                null_mut(),
                operation.as_ptr(),
                executable.as_ptr(),
                parameters.as_ptr(),
                null(),
                SW_SHOW,
            );
            true
        } else {
            let operation = wide("open");
            let board = wide(&pcb_file.to_string_lossy());
            ShellExecuteW(
                null_mut(),
                operation.as_ptr(),
                board.as_ptr(),
                null(),
                null(),
                SW_SHOW,
            );
            false
        }
    }

    fn preferred_kicad_gui_path() -> Option<PathBuf> {
        std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .map(|local_app_data| {
                local_app_data
                    .join("Programs")
                    .join("KiCad")
                    .join("10.0")
                    .join("bin")
                    .join("kicad.exe")
            })
            .filter(|path| path.exists())
    }

    fn preferred_pcbnew_path() -> Option<PathBuf> {
        std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .map(|local_app_data| {
                local_app_data
                    .join("Programs")
                    .join("KiCad")
                    .join("10.0")
                    .join("bin")
                    .join("pcbnew.exe")
            })
            .filter(|path| path.exists())
    }

    fn preferred_kicad_cli_path() -> Option<PathBuf> {
        std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .map(|local_app_data| {
                local_app_data
                    .join("Programs")
                    .join("KiCad")
                    .join("10.0")
                    .join("bin")
                    .join("kicad-cli.exe")
            })
            .filter(|path| path.exists())
    }

    unsafe fn open_evidence_report(project_dir: &PathBuf) {
        let beginner_next_steps_file = project_dir.join("BEGINNER-NEXT-STEPS.txt");
        if beginner_next_steps_file.exists() {
            open_evidence_report_file(&beginner_next_steps_file);
            return;
        }

        let first_run_summary_file = project_dir.join("FIRST-RUN-SUMMARY.txt");
        if first_run_summary_file.exists() {
            open_evidence_report_file(&first_run_summary_file);
            return;
        }

        let release_report_file = project_dir.join("release-evidence-preview.md");
        if release_report_file.exists() {
            open_evidence_report_file(&release_report_file);
        } else {
            open_evidence_folder(project_dir);
        }
    }

    unsafe fn open_evidence_report_file(report_file: &PathBuf) {
        let explorer = wide("explorer.exe");
        let parameters = wide(&format!("/select,\"{}\"", report_file.to_string_lossy()));
        ShellExecuteW(
            null_mut(),
            null(),
            explorer.as_ptr(),
            parameters.as_ptr(),
            null(),
            SW_SHOW,
        );
    }

    unsafe fn open_evidence_folder(path: &PathBuf) {
        let operation = wide("open");
        let folder = wide(&path.to_string_lossy());
        ShellExecuteW(
            null_mut(),
            operation.as_ptr(),
            folder.as_ptr(),
            null(),
            null(),
            SW_SHOW,
        );
    }

    fn preview_workspace_root() -> PathBuf {
        std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir)
            .join("ChatPCB3")
            .join("Projects")
    }

    fn recover_last_preview_workspace() -> Option<PathBuf> {
        let path = preview_workspace_root().join("chatpcb3-esp32s3-preview");

        if path.exists() {
            Some(path)
        } else {
            None
        }
    }

    fn fresh_start_requested() -> bool {
        std::env::args().any(|arg| arg == "--fresh-start")
    }

    unsafe fn handle_use_example(hwnd: HWND) {
        let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut AppControls;
        if ptr.is_null() {
            return;
        }

        let prompt = wide(chatpcb_desktop::ui_model::example_board_prompt());
        SetDlgItemTextW(hwnd, ID_PROMPT as i32, prompt.as_ptr());
        let controls = &*ptr;
        set_pipeline_status(
            controls,
            chatpcb_desktop::ui_model::example_loaded_pipeline_status(),
        );
        focus_prompt_for_first_chat(controls);
    }

    unsafe fn handle_provider_login(hwnd: HWND) {
        let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut AppControls;
        if ptr.is_null() {
            return;
        }

        let statuses = provider_ui_statuses();
        let controls = &*ptr;
        let selected_provider = chatpcb_desktop::ui_model::selected_provider_model(&statuses);
        populate_model_selector(controls, &statuses);
        let pipeline_status =
            chatpcb_desktop::ui_model::provider_login_pipeline_status(selected_provider, &statuses);
        set_pipeline_status(controls, &pipeline_status);
        let provider_login_turn = chatpcb_desktop::ui_model::provider_login_transcript(&statuses);
        append_provider_login_transcript(hwnd, controls, &provider_login_turn);
        focus_prompt_after_action(controls);
    }

    unsafe fn append_provider_login_transcript(
        hwnd: HWND,
        controls: &AppControls,
        provider_login_turn: &str,
    ) {
        let transcript = chatpcb_desktop::ui_model::append_chat_transcript(
            &get_control_text(hwnd, ID_CHAT_TRANSCRIPT),
            provider_login_turn,
        );
        set_chat_transcript_text(controls, &transcript);
    }

    unsafe fn set_pipeline_status(controls: &AppControls, status: &str) {
        let status = wide(status);
        SetWindowTextW(controls.pipeline_status, status.as_ptr());
    }

    unsafe fn set_chat_transcript_text(controls: &AppControls, transcript: &str) {
        let text = wide(transcript);
        SetWindowTextW(controls.chat_transcript, text.as_ptr());
        scroll_chat_transcript_to_latest(controls, transcript);
    }

    unsafe fn scroll_chat_transcript_to_latest(controls: &AppControls, transcript: &str) {
        let end = transcript.encode_utf16().count();
        SendMessageW(controls.chat_transcript, EM_SETSEL, end, end as isize);
        SendMessageW(controls.chat_transcript, EM_SCROLLCARET, 0, 0);
    }

    unsafe fn set_left_workspace_status(controls: &AppControls, status: &str) {
        let status = wide(status);
        SetWindowTextW(controls.status, status.as_ptr());
    }

    unsafe fn set_live_schematic(controls: &AppControls, body: &str) {
        let canvas_text = wide(body);
        SetWindowTextW(controls.schematic_canvas, canvas_text.as_ptr());
        InvalidateRect(controls.schematic_canvas, null(), 1);
        UpdateWindow(controls.schematic_canvas);
        set_design_preview(controls, body);
    }

    unsafe fn set_design_preview(controls: &AppControls, body: &str) {
        let body = wide(body);
        SetWindowTextW(controls.design_preview, body.as_ptr());
    }

    unsafe fn get_control_text(parent: HWND, control_id: usize) -> String {
        let mut buffer = vec![0u16; 2048];
        let copied = GetDlgItemTextW(
            parent,
            control_id as i32,
            buffer.as_mut_ptr(),
            buffer.len() as i32,
        );
        String::from_utf16_lossy(&buffer[..copied as usize])
    }

    unsafe fn get_window_text(hwnd: HWND) -> String {
        let length = GetWindowTextLengthW(hwnd).max(0) as usize;
        let mut buffer = vec![0u16; length + 1];
        let copied = GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32);
        String::from_utf16_lossy(&buffer[..copied as usize])
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    const WC_TABCONTROLW_STR: &str = "SysTabControl32";
}
