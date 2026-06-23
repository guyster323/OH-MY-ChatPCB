#pragma once

#include <wx/process.h>
#include <wx/string.h>

class CHATPCB_CORE_CLIENT
{
public:
    CHATPCB_CORE_CLIENT();
    ~CHATPCB_CORE_CLIENT();

    void SetExecutablePath( const wxString& executablePath );
    bool IsRunning() const;
    bool Start( wxString* errorMessage = nullptr );
    bool Request( const wxString& method, const wxString& paramsJson,
                  wxString* responseJson, wxString* errorMessage = nullptr );
    void Stop();

private:
    bool WriteJsonLine( const wxString& jsonLine, wxString* errorMessage );
    bool ReadJsonLine( wxString* responseJson, wxString* errorMessage );

    wxString   m_executablePath;
    wxProcess* m_process;
    long       m_pid;
};
