#include "chatpcb_panel.h"

#include <kiway_player.h>
#include <project.h>
#include <sch_edit_frame.h>
#include <schematic.h>

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
        m_agentProcess( nullptr )
{
    auto* sizer = new wxBoxSizer( wxVERTICAL );
    m_webView = wxWebView::New( this, wxID_ANY );
    sizer->Add( m_webView, 1, wxEXPAND );
    SetSizer( sizer );

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
    try
    {
        const nlohmann::json request =
                nlohmann::json::parse( aEvent.GetString().ToUTF8().data() );

        if( !request.is_object() )
        {
            PostHostEvent( { { "type", "project.status" },
                             { "projectPath", "" },
                             { "dirty", IsEditorDirty() },
                             { "linkState", "invalid" } } );
            return;
        }

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
                                                      : "unlinked" } } );
        }
        else if( type == "project.open" )
        {
            OpenProject( projectPath );
        }
        else if( type == "project.reload" && IsEditorDirty() )
        {
            PostHostEvent( { { "type", "project.status" },
                             { "projectPath", ToUtf8( projectPath ) },
                             { "linkState", "conflict" },
                             { "dirty", true } } );
        }
        else if( type == "project.reload" )
        {
            ReloadActiveProject( projectPath );
        }
    }
    catch( const nlohmann::json::exception& error )
    {
        wxLogWarning( "Rejected invalid ChatPCB host message: %s", error.what() );
        PostHostEvent( { { "type", "project.status" },
                         { "projectPath", "" },
                         { "dirty", IsEditorDirty() },
                         { "linkState", "invalid" } } );
    }
}

void CHATPCB_PANEL::PostHostEvent( const nlohmann::json& aEvent )
{
    const wxString script = wxString::Format(
            wxT( "window.postMessage(%s, '*');" ),
            wxString::FromUTF8( aEvent.dump() ) );
    m_webView->RunScriptAsync( script );
}

void CHATPCB_PANEL::OpenProject( const wxString& aProjectPath )
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
                         { "linkState", "invalid" } } );
        return;
    }

    if( IsEditorDirty() )
    {
        PostHostEvent( { { "type", "project.status" },
                         { "projectPath", ToUtf8( responsePath ) },
                         { "dirty", true },
                         { "linkState", "conflict" } } );
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
                         { "linkState", "error" } } );
        return;
    }

    PostHostEvent( { { "type", "project.status" },
                     { "projectPath", ToUtf8( responsePath ) },
                     { "dirty", IsEditorDirty() },
                     { "linkState", "linked" } } );
}

bool CHATPCB_PANEL::IsEditorDirty() const
{
    return m_frame && m_frame->IsContentModified();
}

void CHATPCB_PANEL::ReloadActiveProject( const wxString& aProjectPath )
{
    if( !m_frame || IsEditorDirty() || !RequestedProjectIsActive( m_frame, aProjectPath ) )
    {
        PostHostEvent( { { "type", "project.reload" },
                         { "projectPath", ToUtf8( aProjectPath ) },
                         { "linkState", IsEditorDirty() ? "conflict" : "unlinked" },
                         { "completed", false } } );
        return;
    }

    const wxString schematicPath = m_frame->Schematic().GetFileName();

    if( schematicPath.IsEmpty() || !wxFileName::FileExists( schematicPath ) )
    {
        PostHostEvent( { { "type", "project.reload" },
                         { "projectPath", ToUtf8( aProjectPath ) },
                         { "linkState", "error" },
                         { "completed", false } } );
        return;
    }

    m_frame->ReleaseFile();
    const bool reloaded = m_frame->OpenProjectFiles( { schematicPath }, KICTL_REVERT );

    if( reloaded )
    {
        PostHostEvent( { { "type", "project.reload" },
                         { "projectPath", ToUtf8( aProjectPath ) },
                         { "linkState", "reloaded" },
                         { "completed", true } } );
    }
    else
    {
        PostHostEvent( { { "type", "project.reload" },
                         { "projectPath", ToUtf8( aProjectPath ) },
                         { "linkState", "error" },
                         { "completed", false } } );
    }
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
