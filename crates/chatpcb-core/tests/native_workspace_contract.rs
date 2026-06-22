use std::fs;
use std::path::PathBuf;

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .unwrap()
        .to_path_buf()
}

#[test]
fn native_workspace_uses_wxwidgets_splitter_and_never_webview() {
    let root = workspace_root();
    let header = fs::read_to_string(
        root.join("kicad-fork/plugins/chatpcb_native_workspace/chatpcb_workspace_panel.h"),
    )
    .unwrap();
    let source = fs::read_to_string(
        root.join("kicad-fork/plugins/chatpcb_native_workspace/chatpcb_workspace_panel.cpp"),
    )
    .unwrap();
    let combined = format!("{header}\n{source}");

    assert!(combined.contains("wxSplitterWindow"));
    assert!(combined.contains("wxNotebook"));
    assert!(combined.contains("CHATPCB_WORKSPACE_LEFT_RATIO"));
    assert!(combined.contains("Provider Login"));
    assert!(combined.contains("Model"));
    assert!(!combined.contains("wxWebView"));
    assert!(!combined.contains("<html"));
    assert!(!combined.contains("http://"));
    assert!(!combined.contains("https://"));
}
