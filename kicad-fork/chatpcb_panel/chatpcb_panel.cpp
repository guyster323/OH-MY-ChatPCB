#include "chatpcb_panel.h"

#include <wx/filename.h>
#include <wx/log.h>
#include <wx/sizer.h>
#include <wx/stdpaths.h>
#include <wx/utils.h>

namespace
{
constexpr int CHATPCB_AGENT_PORT = 41317;

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
        m_webView( nullptr ),
        m_agentProcess( nullptr )
{
    auto* sizer = new wxBoxSizer( wxVERTICAL );
    m_webView = wxWebView::New( this, wxID_ANY );
    sizer->Add( m_webView, 1, wxEXPAND );
    SetSizer( sizer );
    LoadPanel();
}

CHATPCB_PANEL::~CHATPCB_PANEL()
{
    if( m_agentProcess )
    {
        m_agentProcess->Detach();
        m_agentProcess = nullptr;
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
