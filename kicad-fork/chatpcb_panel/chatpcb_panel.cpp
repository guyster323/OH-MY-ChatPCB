#include "chatpcb_panel.h"

#include <base_units.h>
#include <kiway_player.h>
#include <project.h>
#include <sch_edit_frame.h>
#include <sch_label.h>
#include <sch_symbol.h>
#include <schematic.h>
#include <tool/tool_manager.h>
#include <tools/sch_selection_tool.h>

#include <wx/datetime.h>
#include <wx/event.h>
#include <wx/filename.h>
#include <wx/log.h>
#include <wx/sizer.h>
#include <wx/stdpaths.h>
#include <wx/utils.h>

#include <nlohmann/json.hpp>

namespace
{
constexpr int CHATPCB_AGENT_PORT = 41317;

std::string ToUtf8( const wxString& aValue )
{
    return std::string( aValue.ToUTF8().data() );
}

bool RequestedProjectIsActive( SCH_EDIT_FRAME* aFrame, const wxString& aRequestedPath )
{
    if( !aFrame || aRequestedPath.IsEmpty() )
        return false;

    wxFileName activeProject( aFrame->Prj().GetProjectFullName() );

    if( !activeProject.IsOk() || activeProject.GetFullPath().IsEmpty() )
        return false;

    wxFileName requestedProject( aRequestedPath );

    if( requestedProject.GetExt().CmpNoCase( wxT( "kicad_pro" ) ) == 0 )
        return requestedProject.SameAs( activeProject );

    return wxFileName::DirName( aRequestedPath ).SameAs(
            wxFileName::DirName( activeProject.GetPath() ) );
}

wxString WithFileCacheBust( const wxString& aUrl )
{
    if( aUrl.Find( '?' ) != wxNOT_FOUND )
        return aUrl;

    if( !aUrl.StartsWith( wxT( "file:" ) ) )
        return aUrl;

    wxString path = aUrl;
    path.Replace( wxT( "file:///" ), wxEmptyString );
    path.Replace( wxT( "file://" ), wxEmptyString );
#ifdef __WXMSW__
    path.Replace( wxT( "/" ), wxString( wxFileName::GetPathSeparator() ) );
#endif
    wxFileName html( path );

    if( !html.FileExists() )
        return aUrl;

    wxDateTime newest = html.GetModificationTime();
    const wxFileName js( html.GetPath(), wxT( "panel.js" ) );
    const wxFileName css( html.GetPath(), wxT( "styles.css" ) );

    if( js.FileExists() && js.GetModificationTime().IsLaterThan( newest ) )
        newest = js.GetModificationTime();

    if( css.FileExists() && css.GetModificationTime().IsLaterThan( newest ) )
        newest = css.GetModificationTime();

    return aUrl + wxString::Format( wxT( "?v=%ld" ), static_cast<long>( newest.GetTicks() ) );
}

wxString ResolveAgentCommand()
{
    wxString explicitCommand;

    if( wxGetEnv( wxT( "CHATPCB_CLI_COMMAND" ), &explicitCommand ) && !explicitCommand.IsEmpty() )
        return explicitCommand;

#ifdef __WXMSW__
    wxString appData;

    if( wxGetEnv( wxT( "APPDATA" ), &appData ) && !appData.IsEmpty() )
    {
        wxFileName npmShim( appData, wxEmptyString );
        npmShim.AppendDir( wxT( "npm" ) );
        npmShim.SetFullName( wxT( "chatpcb.cmd" ) );

        if( npmShim.FileExists() )
        {
            wxString command;
            command.Printf( wxT( "cmd.exe /C \"\"%s\" daemon --host 127.0.0.1 --port %d\"" ),
                            npmShim.GetFullPath(), CHATPCB_AGENT_PORT );
            return command;
        }
    }
#endif

    wxString command;
    command.Printf( wxT( "chatpcb daemon --host 127.0.0.1 --port %d" ), CHATPCB_AGENT_PORT );
    return command;
}
}

CHATPCB_PANEL::CHATPCB_PANEL( wxWindow* parent ) :
        wxPanel( parent ),
        m_frame( dynamic_cast<SCH_EDIT_FRAME*>( parent ) ),
        m_webView( nullptr ),
        m_agentProcess( nullptr ),
        m_hasReportedDirty( false ),
        m_reportedDirty( false )
{
    auto* sizer = new wxBoxSizer( wxVERTICAL );
    m_webView = wxWebView::New( this, wxID_ANY );
    sizer->Add( m_webView, 1, wxEXPAND );
    SetSizer( sizer );

    Bind( wxEVT_IDLE, &CHATPCB_PANEL::OnIdle, this );
    Bind( wxEVT_WEBVIEW_SCRIPT_MESSAGE_RECEIVED, &CHATPCB_PANEL::OnScriptMessage, this,
          m_webView->GetId() );

    if( !m_webView->AddScriptMessageHandler( wxT( "chatpcbHost" ) ) )
        wxLogWarning( "ChatPCB WebView host bridge is unavailable; use the browser fallback." );

    LoadPanel();
}

CHATPCB_PANEL::~CHATPCB_PANEL()
{
    if( m_webView )
    {
        Unbind( wxEVT_WEBVIEW_SCRIPT_MESSAGE_RECEIVED, &CHATPCB_PANEL::OnScriptMessage, this,
                m_webView->GetId() );
        m_webView->RemoveScriptMessageHandler( wxT( "chatpcbHost" ) );
    }

    if( m_agentProcess )
    {
        m_agentProcess->Detach();
        m_agentProcess = nullptr;
    }
}

void CHATPCB_PANEL::OnScriptMessage( wxWebViewEvent& aEvent )
{
    std::string requestId;

    try
    {
        const nlohmann::json request =
                nlohmann::json::parse( aEvent.GetString().ToUTF8().data() );

        if( !request.is_object() )
        {
            PostHostEvent( { { "type", "project.status" },
                             { "projectPath", "" },
                             { "dirty", IsEditorDirty() },
                             { "linkState", "invalid" } },
                           requestId );
            return;
        }

        requestId = request.value( "requestId", std::string() );
        const std::string type = request.value( "type", "" );
        const wxString projectPath = wxString::FromUTF8(
                request.value( "projectPath", std::string() ) );

        if( type == "project.status" )
        {
            const wxString responsePath = projectPath.IsEmpty() && m_frame
                                                ? m_frame->Prj().GetProjectFullName()
                                                : projectPath;

            PostHostEvent( { { "type", "project.status" },
                             { "projectPath", ToUtf8( responsePath ) },
                             { "dirty", IsEditorDirty() },
                             { "linkState", RequestedProjectIsActive( m_frame, responsePath )
                                                      ? "linked"
                                                      : "unlinked" } },
                           requestId );
        }
        else if( type == "project.open" )
        {
            OpenProject( projectPath, requestId );
        }
        else if( type == "project.reload" && IsEditorDirty() )
        {
            PostHostEvent( { { "type", "project.status" },
                             { "projectPath", ToUtf8( projectPath ) },
                             { "linkState", "conflict" },
                             { "dirty", true } },
                           requestId );
        }
        else if( type == "project.reload" )
        {
            ReloadActiveProject( projectPath, requestId );
        }
        else if( type == "selection.get" )
        {
            BuildSelectionContext( requestId, projectPath );
        }
    }
    catch( const nlohmann::json::exception& error )
    {
        wxLogWarning( "Rejected invalid ChatPCB host message: %s", error.what() );
        PostHostEvent( { { "type", "project.status" },
                         { "projectPath", "" },
                         { "dirty", IsEditorDirty() },
                         { "linkState", "invalid" } },
                       requestId );
    }
}

void CHATPCB_PANEL::PostHostEvent( const nlohmann::json& aEvent, const std::string& aRequestId )
{
    nlohmann::json event = aEvent;

    if( !aRequestId.empty() )
        event[ "requestId" ] = aRequestId;

    const wxString payload = wxString::FromUTF8( event.dump() );
    const wxString script = wxT( "window.postMessage(" ) + payload + wxT( ", '*');" );
    m_webView->RunScriptAsync( script );
}

void CHATPCB_PANEL::OpenProject( const wxString& aProjectPath, const std::string& aRequestId )
{
    wxFileName projectFile( aProjectPath );
    const wxString responsePath = projectFile.GetPath();

    if( !m_frame || !projectFile.IsAbsolute()
        || projectFile.GetExt().CmpNoCase( wxT( "kicad_pro" ) ) != 0
        || !projectFile.FileExists() )
    {
        PostHostEvent( { { "type", "project.status" },
                         { "projectPath", ToUtf8( responsePath ) },
                         { "dirty", IsEditorDirty() },
                         { "linkState", "invalid" } },
                       aRequestId );
        return;
    }

    if( IsEditorDirty() )
    {
        PostHostEvent( { { "type", "project.status" },
                         { "projectPath", ToUtf8( responsePath ) },
                         { "dirty", true },
                         { "linkState", "conflict" } },
                       aRequestId );
        return;
    }

    wxFileName schematicFile( projectFile );
    schematicFile.SetExt( wxT( "kicad_sch" ) );

    if( !schematicFile.FileExists()
        || !m_frame->OpenProjectFiles( { schematicFile.GetFullPath() } ) )
    {
        PostHostEvent( { { "type", "project.status" },
                         { "projectPath", ToUtf8( responsePath ) },
                         { "dirty", IsEditorDirty() },
                         { "linkState", "error" } },
                       aRequestId );
        return;
    }

    PostHostEvent( { { "type", "project.status" },
                     { "projectPath", ToUtf8( responsePath ) },
                     { "dirty", IsEditorDirty() },
                     { "linkState", "linked" } },
                   aRequestId );
}

bool CHATPCB_PANEL::IsEditorDirty() const
{
    return m_frame && m_frame->IsContentModified();
}

void CHATPCB_PANEL::OnIdle( wxIdleEvent& aEvent )
{
    const bool dirty = IsEditorDirty();

    if( !m_hasReportedDirty || dirty != m_reportedDirty )
        PostEditorStatus();

    aEvent.Skip();
}

wxString CHATPCB_PANEL::ActiveProjectDirectory() const
{
    if( !m_frame )
        return wxEmptyString;

    wxFileName projectFile( m_frame->Prj().GetProjectFullName() );

    if( projectFile.GetExt().CmpNoCase( wxT( "kicad_pro" ) ) == 0 )
        return projectFile.GetPath();

    return projectFile.GetFullPath();
}

void CHATPCB_PANEL::PostEditorStatus()
{
    const bool dirty = IsEditorDirty();
    const wxString projectPath = ActiveProjectDirectory();

    m_hasReportedDirty = true;
    m_reportedDirty = dirty;
    PostHostEvent( { { "type", "project.status" },
                     { "projectPath", ToUtf8( projectPath ) },
                     { "dirty", dirty },
                     { "linkState", dirty ? "conflict" : ( projectPath.IsEmpty() ? "unlinked" : "linked" ) } },
                   std::string() );
}

void CHATPCB_PANEL::ReloadActiveProject( const wxString& aProjectPath,
                                         const std::string& aRequestId )
{
    if( !m_frame || IsEditorDirty() || !RequestedProjectIsActive( m_frame, aProjectPath ) )
    {
        PostHostEvent( { { "type", "project.reload" },
                         { "projectPath", ToUtf8( aProjectPath ) },
                         { "linkState", IsEditorDirty() ? "conflict" : "unlinked" },
                         { "completed", false } },
                       aRequestId );
        return;
    }

    const wxString schematicPath = m_frame->Schematic().GetFileName();

    if( schematicPath.IsEmpty() || !wxFileName::FileExists( schematicPath ) )
    {
        PostHostEvent( { { "type", "project.reload" },
                         { "projectPath", ToUtf8( aProjectPath ) },
                         { "linkState", "error" },
                         { "completed", false } },
                       aRequestId );
        return;
    }

    m_frame->ReleaseFile();
    const bool reloaded = m_frame->OpenProjectFiles( { schematicPath }, KICTL_REVERT );

    if( reloaded )
    {
        PostHostEvent( { { "type", "project.reload" },
                         { "projectPath", ToUtf8( aProjectPath ) },
                         { "linkState", "reloaded" },
                         { "completed", true } },
                       aRequestId );
    }
    else
    {
        PostHostEvent( { { "type", "project.reload" },
                         { "projectPath", ToUtf8( aProjectPath ) },
                         { "linkState", "error" },
                         { "completed", false } },
                       aRequestId );
    }
}

void CHATPCB_PANEL::BuildSelectionContext( const std::string& aRequestId,
                                           const wxString& aProjectPath )
{
    nlohmann::json items = nlohmann::json::array();
    nlohmann::json diagnostics = nlohmann::json::array();
    wxString sheetPath;
    bool unsupported = false;

    if( m_frame )
    {
        SCH_SHEET_PATH& sheet = m_frame->GetCurrentSheet();
        sheetPath = sheet.PathHumanReadable();

        if( m_frame->GetToolManager()
            && m_frame->GetToolManager()->GetTool<SCH_SELECTION_TOOL>() )
        {
            SCH_SELECTION& selection =
                    m_frame->GetToolManager()->GetTool<SCH_SELECTION_TOOL>()->GetSelection();

            for( EDA_ITEM* selectedItem : selection )
            {
                if( !selectedItem )
                    continue;

                switch( selectedItem->Type() )
                {
                case SCH_SYMBOL_T:
                {
                    SCH_SYMBOL* symbol = static_cast<SCH_SYMBOL*>( selectedItem );
                    const VECTOR2I position = symbol->GetPosition();
                    items.push_back( {
                        { "kind", "symbol" },
                        { "kiid", ToUtf8( symbol->m_Uuid.AsString() ) },
                        { "reference", ToUtf8( symbol->GetRef( &sheet, false ) ) },
                        { "position",
                          { { "x", schIUScale.IUTomm( position.x ) },
                            { "y", schIUScale.IUTomm( position.y ) } } }
                    } );
                    break;
                }

                case SCH_LABEL_T:
                case SCH_GLOBAL_LABEL_T:
                case SCH_HIER_LABEL_T:
                {
                    SCH_LABEL_BASE* label = static_cast<SCH_LABEL_BASE*>( selectedItem );
                    const char* kind = selectedItem->Type() == SCH_LABEL_T
                                               ? "label"
                                               : selectedItem->Type() == SCH_GLOBAL_LABEL_T
                                                         ? "global_label"
                                                         : "hierarchical_label";
                    const VECTOR2I position = label->GetPosition();
                    items.push_back( {
                        { "kind", kind },
                        { "kiid", ToUtf8( label->m_Uuid.AsString() ) },
                        { "text", ToUtf8( label->GetShownText( &sheet, false ) ) },
                        { "position",
                          { { "x", schIUScale.IUTomm( position.x ) },
                            { "y", schIUScale.IUTomm( position.y ) } } }
                    } );
                    break;
                }

                default:
                    unsupported = true;
                    break;
                }
            }
        }
    }

    if( unsupported )
    {
        diagnostics.push_back( {
            { "code", "KICAD_SELECTION_UNSUPPORTED" },
            { "message", items.empty() ? "No supported selection anchors were captured."
                                       : "Unsupported selection items were omitted." }
        } );
    }

    nlohmann::json response = {
        { "type", "selection.context" },
        { "projectPath", ToUtf8( aProjectPath ) },
        { "editor", "schematic" },
        { "dirty", IsEditorDirty() },
        { "items", items },
        { "diagnostics", diagnostics }
    };

    if( !sheetPath.IsEmpty() )
        response[ "sheet" ] = ToUtf8( sheetPath );

    PostHostEvent( response, aRequestId );
}

void CHATPCB_PANEL::LoadPanel()
{
    EnsureAgentRunning();
    m_webView->LoadURL( ResolvePanelUrl() );
}

void CHATPCB_PANEL::EnsureAgentRunning()
{
    if( m_agentProcess )
        return;

    m_agentProcess = new wxProcess( this );
    long pid = wxExecute( ResolveAgentCommand(), wxEXEC_ASYNC, m_agentProcess );

    if( pid == 0 )
    {
        wxLogWarning( "ChatPCB agent daemon did not start. Run `chatpcb daemon` manually." );
        delete m_agentProcess;
        m_agentProcess = nullptr;
    }
}

wxString CHATPCB_PANEL::ResolvePanelUrl() const
{
    wxString explicitUrl;

    if( wxGetEnv( wxT( "CHATPCB_PANEL_URL" ), &explicitUrl ) && !explicitUrl.IsEmpty() )
        return WithFileCacheBust( explicitUrl );

#ifdef CHATPCB_PANEL_ASSET_URL
    return wxString::FromUTF8( CHATPCB_PANEL_ASSET_URL );
#else
    wxFileName panelPath( wxStandardPaths::Get().GetExecutablePath() );
    panelPath.RemoveLastDir();
    panelPath.AppendDir( "share" );
    panelPath.AppendDir( "chatpcb_panel" );
    panelPath.SetFullName( "index.html" );
    return panelPath.GetFullPath();
#endif
}
