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

#[test]
fn native_workspace_is_a_kicad_cmake_drop_in_with_stdio_core_bridge() {
    let root = workspace_root();
    let plugin_dir = root.join("kicad-fork/plugins/chatpcb_native_workspace");
    let cmake = fs::read_to_string(plugin_dir.join("CMakeLists.txt")).unwrap();
    let client_header = fs::read_to_string(plugin_dir.join("chatpcb_core_client.h")).unwrap();
    let client_source = fs::read_to_string(plugin_dir.join("chatpcb_core_client.cpp")).unwrap();
    let panel_header = fs::read_to_string(plugin_dir.join("chatpcb_workspace_panel.h")).unwrap();
    let panel_source = fs::read_to_string(plugin_dir.join("chatpcb_workspace_panel.cpp")).unwrap();
    let combined =
        format!("{cmake}\n{client_header}\n{client_source}\n{panel_header}\n{panel_source}");

    assert!(cmake.contains("add_library( chatpcb_native_workspace STATIC"));
    assert!(cmake.contains("chatpcb_workspace_panel.cpp"));
    assert!(cmake.contains("chatpcb_core_client.cpp"));
    assert!(cmake.contains("find_package( wxWidgets"));
    assert!(cmake.contains("include( ${wxWidgets_USE_FILE} )"));
    assert!(cmake.contains("target_compile_features( chatpcb_native_workspace"));
    assert!(cmake.contains("target_include_directories( chatpcb_native_workspace"));

    assert!(client_header.contains("class CHATPCB_CORE_CLIENT"));
    assert!(client_header.contains("SetExecutablePath"));
    assert!(client_header.contains("Request"));
    assert!(client_source.contains("chatpcb-core.exe"));
    assert!(client_source.contains("#include <wx/utils.h>"));
    assert!(client_source.contains("wxProcess"));
    assert!(client_source.contains("wxEXEC_ASYNC"));
    assert!(client_source.contains("WriteJsonLine"));
    assert!(client_source.contains("ReadJsonLine"));

    assert!(panel_header.contains("CHATPCB_CORE_CLIENT"));
    assert!(panel_header.contains("SetCoreExecutablePath"));
    assert!(panel_source.contains("m_coreClient"));
    assert!(panel_source.contains("provider.list"));
    assert!(panel_source.contains("project.create"));

    assert!(!combined.contains("wxWebView"));
    assert!(!combined.contains("<html"));
    assert!(!combined.contains("http://"));
    assert!(!combined.contains("https://"));
    assert!(!combined.contains("WebSocket"));
}
