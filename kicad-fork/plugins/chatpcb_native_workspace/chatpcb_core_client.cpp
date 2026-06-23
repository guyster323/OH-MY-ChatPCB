#include "chatpcb_core_client.h"

#include <wx/sstream.h>
#include <wx/txtstrm.h>
#include <wx/utils.h>

CHATPCB_CORE_CLIENT::CHATPCB_CORE_CLIENT() :
        m_executablePath( "chatpcb-core.exe" ),
        m_process( nullptr ),
        m_pid( 0 )
{
}

CHATPCB_CORE_CLIENT::~CHATPCB_CORE_CLIENT()
{
    Stop();
}

void CHATPCB_CORE_CLIENT::SetExecutablePath( const wxString& executablePath )
{
    m_executablePath = executablePath;
}

bool CHATPCB_CORE_CLIENT::IsRunning() const
{
    return m_process != nullptr && m_pid != 0;
}

bool CHATPCB_CORE_CLIENT::Start( wxString* errorMessage )
{
    if( IsRunning() )
        return true;

    m_process = new wxProcess();
    m_process->Redirect();

    m_pid = wxExecute( m_executablePath, wxEXEC_ASYNC, m_process );

    if( m_pid == 0 )
    {
        delete m_process;
        m_process = nullptr;

        if( errorMessage )
            *errorMessage = "Could not start chatpcb-core.exe.";

        return false;
    }

    return true;
}

bool CHATPCB_CORE_CLIENT::Request( const wxString& method, const wxString& paramsJson,
                                  wxString* responseJson, wxString* errorMessage )
{
    if( !Start( errorMessage ) )
        return false;

    wxString requestJson;
    requestJson << "{\"id\":\"kicad-panel\",\"method\":\"" << method
                << "\",\"params\":" << paramsJson << "}";

    if( !WriteJsonLine( requestJson, errorMessage ) )
        return false;

    return ReadJsonLine( responseJson, errorMessage );
}

void CHATPCB_CORE_CLIENT::Stop()
{
    if( m_pid != 0 )
        wxProcess::Kill( m_pid, wxSIGTERM );

    delete m_process;
    m_process = nullptr;
    m_pid = 0;
}

bool CHATPCB_CORE_CLIENT::WriteJsonLine( const wxString& jsonLine, wxString* errorMessage )
{
    if( !m_process || !m_process->GetOutputStream() )
    {
        if( errorMessage )
            *errorMessage = "chatpcb-core.exe stdin is not available.";

        return false;
    }

    wxTextOutputStream output( *m_process->GetOutputStream() );
    output << jsonLine << "\n";
    m_process->GetOutputStream()->Sync();
    return true;
}

bool CHATPCB_CORE_CLIENT::ReadJsonLine( wxString* responseJson, wxString* errorMessage )
{
    if( !m_process || !m_process->GetInputStream() )
    {
        if( errorMessage )
            *errorMessage = "chatpcb-core.exe stdout is not available.";

        return false;
    }

    wxTextInputStream input( *m_process->GetInputStream() );
    *responseJson = input.ReadLine();

    if( responseJson->empty() )
    {
        if( errorMessage )
            *errorMessage = "chatpcb-core.exe returned an empty JSONL response.";

        return false;
    }

    return true;
}
