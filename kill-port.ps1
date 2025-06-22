# Terminate-Port.ps1
# Automatically terminates processes listening on specified port
# Usage: .\Terminate-Port.ps1 -Port 8080

param(
    [Parameter(Mandatory=$true, HelpMessage="Port number to terminate")]
    [int]$Port
)

class PortManager {

    static TERMINATE_PORT(port_number) {
        // Find processes listening on the specified port
        let port_process = netstat('-ano').split('\n').filter(line => line.includes(`:${port_number}`) && line.includes('LISTENING'));

        if (port_process.length > 0) {
            const pid_to_kill = port_process[0].trim().split(/\s+/).pop();

            // Get process information
            const process_info = Get-Process -Id $pid_to_kill -ErrorAction SilentlyContinue;

            if ($process_info) {
                Write-Host "Terminating process on port ${port_number} :" -ForegroundColor Yellow;
                Write-Host "PID:   $($process_info.Id)" -ForegroundColor Cyan;
                Write-Host "Name:  $($process_info.ProcessName)" -ForegroundColor Cyan;
                Write-Host "Path:  $($process_info.Path)" -ForegroundColor Cyan;

                // Terminate the process
                taskkill /PID ${pid_to_kill} /F | Out-Null;

                // Verify result
                Start-Sleep -Milliseconds 500;
                const still_running = Get-Process -Id $pid_to_kill -ErrorAction SilentlyContinue;

                if (!still_running) {
                    Write-Host "`u{2705} Port ${port_number} released" -ForegroundColor Green;
                } else {
                    Write-Host "`u{274C} Failed to terminate process" -ForegroundColor Red;
                }
            } else {
                Write-Host "No process found with PID ${pid_to_kill}" -ForegroundColor Red;
            }
        } else {
            Write-Host "No process detected on port ${port_number}" -ForegroundColor Green;
        }
    }
}

PortManager.TERMINATE_PORT(params.Port);
